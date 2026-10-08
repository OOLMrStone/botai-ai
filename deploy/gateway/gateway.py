"""Private, fixed-upstream OpenAI gateway. Never logs payloads or credentials."""
import hmac
import http.client
import json
import logging
import os
import ssl
import socket
import time
import uuid
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

UPSTREAM_DEADLINE_SECONDS = 360
CONNECT_TIMEOUT_SECONDS = 30
logger = logging.getLogger('botai.gateway')

MAX_BODY = 48 * 1024 * 1024
MAX_RESPONSE = 8 * 1024 * 1024
ALLOWED = {'model', 'messages', 'tools', 'tool_choice', 'parallel_tool_calls',
           'response_format', 'max_tokens', 'max_completion_tokens', 'temperature',
           'top_p', 'stop', 'presence_penalty', 'frequency_penalty', 'seed',
           'thinking', 'reasoning_effort', 'stream', 'n'}

class Gateway(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, config):
        self.config = config
        self.slots = threading.BoundedSemaphore(4)
        self.connection_slots = threading.BoundedSemaphore(24)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        # Bound threads before parsing unauthenticated request headers.
        if not self.connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()


def redact_json(value, secrets):
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, '[REDACTED]')
        return value
    if isinstance(value, list):
        return [redact_json(item, secrets) for item in value]
    if isinstance(value, dict):
        return {redact_json(key, secrets): redact_json(item, secrets)
                for key, item in value.items()}
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = 'BotAI-Gateway'
    def setup(self):
        super().setup()
        self.connection.settimeout(20)
    def log_message(self, *args):
        pass
    def reply(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True
    def error(self, status, code):
        self.reply(status, {'error': {'type': 'gateway_error', 'code': code, 'message': code}})
    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'status': 'ok', 'service': 'botai-gateway'})
        else:
            self.error(404, 'not_found')
    def do_POST(self):
        cfg = self.server.config
        if self.path != '/v1/chat/completions':
            return self.error(404, 'not_found')
        auth = self.headers.get('Authorization', '')
        expected = 'Bearer ' + cfg['client_token']
        if not hmac.compare_digest(auth.encode(), expected.encode()):
            return self.error(401, 'unauthorized')
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
            return self.error(400, 'invalid_framing')
        try:
            size = int(self.headers['Content-Length'])
        except (ValueError, TypeError):
            return self.error(400, 'invalid_length')
        if not 0 < size <= MAX_BODY:
            return self.error(413, 'request_too_large')
        if not self.server.slots.acquire(blocking=False):
            return self.error(429, 'gateway_busy')
        conn = None
        res = None
        watchdog = None
        deadline = None
        expired = threading.Event()
        request_id = uuid.uuid4().hex
        started = time.monotonic()
        stage = 'body'
        upstream_status = 0

        def record(event):
            logger.info('request_id=%s event=%s stage=%s elapsed_ms=%d upstream_status=%d',
                        request_id, event, stage, int((time.monotonic() - started) * 1000),
                        upstream_status)

        def require_time():
            if expired.is_set() or time.monotonic() >= deadline:
                expired.set()
                raise TimeoutError()

        try:
            raw = self.rfile.read(size)
            if len(raw) != size:
                return self.error(400, 'incomplete_body')
            try:
                body = json.loads(raw)
            except (ValueError, RecursionError):
                return self.error(400, 'invalid_json')
            if not isinstance(body, dict) or set(body) - ALLOWED:
                return self.error(400, 'unsupported_fields')
            if body.get('model') != cfg['model']:
                return self.error(400, 'unsupported_model')
            if body.get('stream', False) is not False or body.get('n', 1) != 1:
                return self.error(400, 'unsupported_mode')
            if not isinstance(body.get('messages'), list) or not body['messages']:
                return self.error(400, 'invalid_messages')
            upstream = urlsplit(cfg['upstream'])
            if upstream.scheme != 'https' or upstream.hostname != 'api.deepseek.com' or upstream.port not in (None, 443):
                return self.error(503, 'invalid_upstream_configuration')
            # DNS resolution is OS-controlled and cannot be interrupted by this socket
            # watchdog. Its elapsed time still counts against the upstream budget.
            deadline = time.monotonic() + UPSTREAM_DEADLINE_SECONDS
            stage = 'connect'
            record('upstream_started')
            conn = http.client.HTTPSConnection(
                upstream.hostname, timeout=min(CONNECT_TIMEOUT_SECONDS, UPSTREAM_DEADLINE_SECONDS),
                context=ssl.create_default_context())
            conn.connect()
            require_time()
            # Keep this reference: getresponse may detach conn.sock for close-delimited
            # responses, and close alone does not interrupt HTTPResponse's makefile.
            upstream_socket = conn.sock
            upstream_socket.settimeout(max(0.001, deadline - time.monotonic()))

            def interrupt_upstream():
                expired.set()
                try:
                    upstream_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            watchdog = threading.Timer(max(0, deadline - time.monotonic()), interrupt_upstream)
            watchdog.daemon = True
            watchdog.start()
            stage = 'send'

            conn.request('POST', '/chat/completions', body=json.dumps(body).encode(), headers={
                'Authorization': 'Bearer ' + cfg['provider_key'],
                'Content-Type': 'application/json', 'Accept': 'application/json'})
            require_time()
            stage = 'headers'
            res = conn.getresponse()
            upstream_status = res.status
            record('upstream_headers')
            require_time()
            # No redirects, no upstream headers/error text exposed.
            if res.status != 200:
                return self.error(502, 'upstream_error')
            stage = 'response_body'
            result = res.read(MAX_RESPONSE + 1)
            require_time()
            watchdog.cancel()
            watchdog.join()
            require_time()
            if len(result) > MAX_RESPONSE:
                return self.error(502, 'upstream_response_too_large')
            try:
                parsed = json.loads(result)
            except (ValueError, RecursionError):
                return self.error(502, 'invalid_upstream_response')
            if not isinstance(parsed, dict) or 'choices' not in parsed:
                return self.error(502, 'invalid_upstream_response')
            stage = 'reply'
            self.reply(200, redact_json(parsed, (cfg['provider_key'], cfg['client_token'])))
            record('completed')
        except (OSError, http.client.HTTPException):
            if deadline is not None and time.monotonic() >= deadline:
                expired.set()
            try:
                record('deadline_exceeded' if expired.is_set() else 'transport_error')
                self.error(504 if expired.is_set() else 502,
                           'upstream_timeout' if expired.is_set() else 'upstream_unavailable')
            except OSError:
                pass
        finally:
            if watchdog:
                watchdog.cancel()
                watchdog.join()
            try:
                try:
                    if res:
                        res.close()
                finally:
                    if conn:
                        conn.close()
            except OSError:
                pass
            finally:
                self.server.slots.release()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    credential = os.path.join(os.environ['CREDENTIALS_DIRECTORY'], 'gateway.json')
    with open(credential) as f:
        config = json.load(f)
    Gateway(('127.0.0.1', 8091), config).serve_forever()
