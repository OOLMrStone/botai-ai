import os
import http.client
import socket
import ssl
import threading
import time
import unittest
from unittest.mock import Mock, patch
from transport import HOST, PinnedProviderConnection, ProviderTransport, validate_provider_url, validate_read_query


class TransportTests(unittest.TestCase):
    def test_content_cannot_choose_destination_or_ambiguous_route(self):
        for url in ['https://evil.example/catalog/203', 'https://3.shkolkovo.online/api/admin',
                    'https://3.shkolkovo.online/catalog/203?token=secret',
                    'https://3.shkolkovo.online/catalog/%252e%252e/admin',
                    'https://3.shkolkovo.online/catalog/../admin',
                    'https://3.shkolkovo.online/catalog/203?Page=1&Page=2',
                    'https://3.shkolkovo.online/catalog/203?Page=0']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_provider_url(url)
        validate_provider_url('https://3.shkolkovo.online/catalog/203?Page=2')

    def test_query_shape_cannot_contain_secrets_or_commands(self):
        for body in [{'token': 'secret'}, {'Page': True}, {'PerPage': 1000}, {'ThemeId': -1}, []]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_read_query(body)
        validate_read_query({'ThemeId': 203, 'Page': 1, 'PerPage': 20})

    def test_connection_pins_resolved_address_and_keeps_fixed_tls_identity(self):
        address = ('240.0.0.188', 443)
        raw, context = Mock(), Mock()
        context.check_hostname, context.verify_mode = True, ssl.CERT_REQUIRED
        context.wrap_socket.return_value = raw
        with patch('transport.ssl.create_default_context', return_value=context), \
                patch('transport.socket.socket', return_value=raw), \
                patch('transport.socket.getaddrinfo', side_effect=AssertionError('must not resolve twice')):
            connection = PinnedProviderConnection(((socket.AF_INET, address),))
            connection.connect()
            raw.connect.assert_called_once_with(address)
            context.wrap_socket.assert_called_once_with(raw, server_hostname=HOST, do_handshake_on_connect=False)
            raw.do_handshake.assert_called_once()

    def test_certificate_bypass_is_not_a_configuration_option(self):
        context = Mock(check_hostname=False, verify_mode=ssl.CERT_NONE)
        with patch('transport.ssl.create_default_context', return_value=context), self.assertRaises(ValueError):
            PinnedProviderConnection(((socket.AF_INET, ('240.0.0.188', 443)),))

    def test_environment_proxy_is_not_used_and_redirect_is_not_followed(self):
        response, connection = Mock(), Mock()
        response.status = 302
        response.read1.return_value = b''
        response.getheader.side_effect = lambda key, default=None: '0' if key == 'Content-Length' else default
        connection.getresponse.return_value = response
        connection.cancelled.is_set.return_value = False
        connection.deadline = time.monotonic() + 30
        transport = ProviderTransport()
        transport._addresses = ((socket.AF_INET, ('240.0.0.188', 443)),)
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://secret-proxy.invalid:8080'}), \
                patch('transport.PinnedProviderConnection', return_value=connection):
            result = transport.fetch('https://3.shkolkovo.online/catalog/203', None)
        self.assertEqual(result.status, 302)
        self.assertEqual(connection.request.call_count, 1)
        headers = connection.request.call_args[0][3]
        self.assertEqual(headers['Host'], HOST)
        self.assertNotIn('Authorization', headers)
        self.assertNotIn('Cookie', headers)

    def local_response(self, mode):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        address = listener.getsockname()
        finished = threading.Event()

        def serve():
            peer, _ = listener.accept()
            try:
                if mode != 'handshake':
                    peer.recv(8192)
                if mode == 'close':
                    peer.sendall(b'HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nexact body')
                elif mode == 'body':
                    peer.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nabc')
                    finished.wait(1)
                else:
                    finished.wait(1)
            finally:
                peer.close()
                listener.close()

        threading.Thread(target=serve, daemon=True).start()

        class OfflineTlsSocket:
            def __init__(self, raw):
                self.raw = raw

            def __getattr__(self, name):
                return getattr(self.raw, name)

            def do_handshake(self):
                if mode == 'handshake':
                    self.raw.recv(1)

        context = Mock(check_hostname=True, verify_mode=ssl.CERT_REQUIRED)
        context.wrap_socket.side_effect = lambda raw, **kwargs: OfflineTlsSocket(raw)
        transport = ProviderTransport()
        transport._addresses = ((socket.AF_INET, address),)
        start = time.monotonic()
        try:
            with patch('transport.ssl.create_default_context', return_value=context), \
                    patch('transport.HTTP_DEADLINE_SECONDS', .15):
                return transport.fetch('https://3.shkolkovo.online/catalog/203', None)
        finally:
            finished.set()
            self.assertLess(time.monotonic() - start, .8)

    def test_close_delimited_body_retains_owned_socket(self):
        self.assertEqual(self.local_response('close').body, b'exact body')

    def test_total_deadline_interrupts_headers_body_and_handshake(self):
        for stage in ('headers', 'body', 'handshake'):
            with self.subTest(stage=stage), self.assertRaises((TimeoutError, OSError, ValueError, http.client.HTTPException)):
                self.local_response(stage)


if __name__ == '__main__':
    unittest.main()
