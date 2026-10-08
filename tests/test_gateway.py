"""Offline gateway boundary tests: the upstream transport is always replaced."""
import http.client
import importlib.util
import json
from pathlib import Path
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

_spec = importlib.util.spec_from_file_location(
    "botai_gateway_under_test", Path(__file__).parents[1] / "deploy/gateway/gateway.py"
)
gateway = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gateway)


@pytest.fixture
def instance(monkeypatch):
    state = SimpleNamespace(status=200, body=b'{"choices": []}', calls=[], error=None,
                            entered=None, release=None)

    class Upstream:
        def __init__(self, host, **kwargs):
            self.host = host
            self.sock = SimpleNamespace(settimeout=lambda timeout: None,
                                        shutdown=lambda how: None)

        def connect(self):
            pass

        def request(self, method, path, body, headers):
            state.calls.append((self.host, method, path, json.loads(body), headers))
            if state.error:
                raise state.error

        def getresponse(self):
            if state.entered:
                state.entered.wait(timeout=5)
                assert state.release.wait(timeout=5)
            return SimpleNamespace(status=state.status, read=lambda size: state.body[:size], close=lambda: None)

        def close(self):
            pass

    monkeypatch.setattr(gateway.http.client, "HTTPSConnection", Upstream)
    config = dict(client_token="test-client-secret", provider_key="test-provider-secret",
                  model="test-model", upstream="https://api.deepseek.com")
    server = gateway.Gateway(("127.0.0.1", 0), config)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
    thread.start()

    def request(body=None, *, path="/v1/chat/completions", auth=True, extra=None):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + config["client_token"]
        headers.update(extra or {})
        conn = http.client.HTTPConnection(*server.server_address, timeout=10)
        payload = {"model": config["model"], "messages": [{"role": "user", "content": "test"}]}
        conn.request("POST", path, json.dumps(payload if body is None else body), headers)
        response = conn.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        conn.close()
        return result

    yield SimpleNamespace(state=state, config=config, request=request, server=server)
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


@pytest.mark.parametrize("options,status", [
    ({"auth": False}, 401),
    ({"extra": {"Authorization": "Bearer wrong"}}, 401),
    ({"path": "/v1/models"}, 404),
    ({"path": "/v1/chat/completions?upstream=https://evil.invalid"}, 404),
    ({"body": {"model": "other", "messages": [{}]}}, 400),
    ({"body": {"model": "test-model", "messages": [{}], "base_url": "https://evil.invalid"}}, 400),
    ({"body": {"model": "test-model", "messages": [{}], "stream": True}}, 400),
    ({"body": {"model": "test-model", "messages": [{}], "n": 2}}, 400),
    ({"body": {"model": "test-model", "messages": []}}, 400),
    ({"extra": {"Transfer-Encoding": "chunked"}}, 400),
])
def test_rejected_requests_never_reach_upstream(instance, options, status):
    assert instance.request(**options)[0] == status
    assert not instance.state.calls


@pytest.mark.parametrize("status", [301, 302, 307, 401, 429, 500])
def test_upstream_errors_and_redirects_never_expose_body(instance, status):
    instance.state.status = status
    instance.state.body = json.dumps(instance.config).encode()
    response_status, headers, body = instance.request()
    assert response_status == 502
    assert json.loads(body)["error"]["code"] == "upstream_error"
    assert instance.config["provider_key"].encode() not in body
    assert "Location" not in headers
    assert len(instance.state.calls) == 1


def test_only_gateway_credentials_are_sent_and_client_headers_are_stripped(instance):
    status, headers, body = instance.request(extra={
        "X-Api-Key": "attacker-key", "Cookie": "private-cookie", "X-Forwarded-Host": "evil.invalid",
        "OpenAI-Organization": "attacker-org",
    })
    assert status == 200
    host, method, path, payload, upstream_headers = instance.state.calls[0]
    assert (host, method, path) == ("api.deepseek.com", "POST", "/chat/completions")
    assert upstream_headers == {"Authorization": "Bearer test-provider-secret",
                                "Content-Type": "application/json", "Accept": "application/json"}
    assert "Authorization" not in headers


def test_success_response_redacts_both_credentials(instance):
    instance.state.body = json.dumps({"choices": [{"message": {"content":
        instance.config["provider_key"] + " " + instance.config["client_token"]}}]}).encode()
    status, _, body = instance.request()
    assert status == 200
    assert b"test-provider-secret" not in body
    assert b"test-client-secret" not in body
    assert body.count(b"[REDACTED]") == 2


def test_transport_exception_does_not_expose_secrets(instance):
    instance.state.error = OSError(instance.config["provider_key"])
    status, _, body = instance.request()
    assert status == 502
    assert json.loads(body)["error"]["code"] == "upstream_unavailable"
    assert instance.config["provider_key"].encode() not in body


@pytest.mark.parametrize("upstream", ["http://api.deepseek.com", "https://evil.invalid",
                                      "https://api.deepseek.com:444"])
def test_configured_upstream_is_allowlisted(instance, upstream):
    instance.config["upstream"] = upstream
    assert instance.request()[0] == 503
    assert not instance.state.calls


def test_concurrency_rejects_fifth_request_and_releases_slots(instance):
    instance.state.entered = threading.Barrier(5)
    instance.state.release = threading.Event()
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = [pool.submit(instance.request) for _ in range(4)]
        try:
            instance.state.entered.wait(timeout=5)
            assert instance.request()[0] == 429
            assert len(instance.state.calls) == 4
        finally:
            instance.state.release.set()
        assert [future.result()[0] for future in pending] == [200] * 4
    instance.state.entered = None
    assert instance.request()[0] == 200


def test_success_response_redacts_unicode_escaped_credentials(instance):
    # A provider may serialize otherwise identical JSON using Unicode escapes.
    secret = instance.config["provider_key"]
    encoded_secret = "".join("\\u%04x" % ord(character) for character in secret)
    instance.state.body = ('{"choices": [{"message": {"content": "' + encoded_secret + '"}}]}').encode()
    status, _, body = instance.request()
    assert status == 200
    assert secret not in json.loads(body)["choices"][0]["message"]["content"]


def test_nested_redaction_covers_keys_values_and_json_escapes(instance):
    secret = instance.config['provider_key']
    token = instance.config['client_token']
    instance.state.body = json.dumps({'choices': [{secret: [token, {token: secret}]}]}).encode()
    status, _, body = instance.request()
    assert status == 200
    assert secret.encode() not in body
    assert token.encode() not in body
    assert json.loads(body) == {'choices': [{'[REDACTED]': ['[REDACTED]', {'[REDACTED]': '[REDACTED]'}]}]}


def test_pre_auth_connections_are_bounded_and_released(instance):
    # Exhaust admission without starting slow clients; rejection must not spawn a thread.
    import socket
    for _ in range(24):
        assert instance.server.connection_slots.acquire(blocking=False)
    rejected, peer = socket.socketpair()
    try:
        instance.server.process_request(rejected, ('127.0.0.1', 1))
        assert peer.recv(1) == b''
    finally:
        rejected.close()
        peer.close()
        for _ in range(24):
            instance.server.connection_slots.release()
    assert instance.request()[0] == 200


def test_connection_admission_released_on_handler_failure(instance, monkeypatch):
    import socket
    def fail(*args):
        raise ValueError('synthetic handler failure')
    monkeypatch.setattr(instance.server, 'finish_request', fail)
    monkeypatch.setattr(instance.server, 'handle_error', lambda *args: None)
    assert instance.server.connection_slots.acquire(blocking=False)
    request, peer = socket.socketpair()
    try:
        instance.server.process_request_thread(request, ('127.0.0.1', 1))
        for _ in range(24):
            assert instance.server.connection_slots.acquire(blocking=False)
        assert not instance.server.connection_slots.acquire(blocking=False)
        for _ in range(24):
            instance.server.connection_slots.release()
    finally:
        request.close()
        peer.close()


@pytest.mark.parametrize('mode', ['chunked_dribble', 'close_delimited_dribble', 'slow_headers', 'quick'])
def test_real_socket_deadline_stops_dribbling_upstream(instance, monkeypatch, mode, caplog):
    """Actual socket reads must stop even when heartbeat bytes reset inactivity timeouts."""
    import logging
    import time
    from http.server import BaseHTTPRequestHandler

    done = threading.Event()

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            try:
                if mode == 'slow_headers':
                    self.wfile.write(b'HTTP/1.1 200 OK\r\nX-Heartbeat: ')
                    self.wfile.flush()
                else:
                    self.send_response(200)
                    if mode == 'chunked_dribble':
                        self.send_header('Transfer-Encoding', 'chunked')
                    elif mode == 'quick':
                        self.send_header('Content-Length', str(len(b'{"choices": []}')))
                    self.end_headers()
                    if mode == 'quick':
                        self.wfile.write(b'{"choices": []}')
                        self.wfile.flush()
                        return
                until = time.monotonic() + 2
                while time.monotonic() < until:
                    self.wfile.write(b'1\r\n \r\n' if mode == 'chunked_dribble' else b' ')
                    self.wfile.flush()
                    time.sleep(.02)
            except (OSError, ValueError):
                pass
            finally:
                done.set()

    # Use the stdlib HTTP server directly, avoiding gateway policy on the fake peer.
    from http.server import ThreadingHTTPServer
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    worker = threading.Thread(target=provider.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
    worker.start()
    monkeypatch.setattr(gateway, 'UPSTREAM_DEADLINE_SECONDS', .25)
    monkeypatch.setattr(gateway.http.client, 'HTTPSConnection',
                        lambda host, **kwargs: http.client.HTTPConnection(
                            *provider.server_address, timeout=kwargs['timeout']))
    caplog.set_level(logging.INFO, logger='botai.gateway')
    started = time.monotonic()
    try:
        status, _, body = instance.request()
        elapsed = time.monotonic() - started
        assert status == (200 if mode == 'quick' else 504)
        if mode != 'quick':
            assert json.loads(body)['error']['code'] == 'upstream_timeout'
            assert .15 <= elapsed < 1.5
        assert done.wait(timeout=1)
        # The request may send its response just before entering finally.
        until = time.monotonic() + 1
        while instance.server.slots._value != 4 and time.monotonic() < until:
            time.sleep(.01)
        acquired = [instance.server.slots.acquire(blocking=False) for _ in range(4)]
        try:
            assert all(acquired)
        finally:
            for held in acquired:
                if held:
                    instance.server.slots.release()
        assert instance.config['provider_key'] not in caplog.text
        assert instance.config['client_token'] not in caplog.text
        assert 'request_id=' in caplog.text
        assert ('event=completed' if mode == 'quick' else 'event=deadline_exceeded') in caplog.text
    finally:
        provider.shutdown()
        provider.server_close()
        worker.join(timeout=2)
