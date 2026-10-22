"""Named read-only Shkolkovo transport; never a general URL proxy."""
from __future__ import annotations

import http.client
import json
import queue
import re
import socket
import ssl
import threading
import time
import urllib.parse
from dataclasses import dataclass

HOST = "3.shkolkovo.online"
DNS_TIMEOUT_SECONDS = 5
HTTP_DEADLINE_SECONDS = 30
MAX_BYTES = 16 * 1024 * 1024
READ_ONLY_POST_PATHS = frozenset({"/api/test/v1/question/public/list", "/api/test/v1/theme/list", "/api/stream/v1/subject/list"})
PATH_PATTERNS = (
    re.compile(r"/catalog(?:/[1-9][0-9]*(?:/[1-9][0-9]*)?)?"),
    re.compile(r"/api/test/v1/theme/by-id/[1-9][0-9]*"),
    re.compile(r"/api/stream/v1/subject/by-id/[1-9][0-9]*"),
    re.compile(r"/api/latex-service/v1/GetSession/[1-9][0-9]*/index-[a-f0-9]{32}\.svg"),
    re.compile(r"/_next/static/[A-Za-z0-9_\[\]./-]+\.js"),
)


def validate_provider_url(url: str) -> None:
    if len(url) > 2048 or any(ord(c) < 33 for c in url) or "\\" in url:
        raise ValueError("Invalid source URL")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != HOST or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.fragment):
        raise ValueError("Only the fixed approved provider origin is allowed")
    path = urllib.parse.unquote(parsed.path)
    if urllib.parse.unquote(path) != path or "//" in path or any(s in {".", ".."} for s in path.split("/")):
        raise ValueError("Ambiguous source path")
    if path not in READ_ONLY_POST_PATHS and not any(pattern.fullmatch(path) for pattern in PATH_PATTERNS):
        raise ValueError("Path is not an observed read-only source route")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True) if parsed.query else {}
    if query:
        allowed = {"SubjectId"} if path == "/catalog" else {"Page"} if path.startswith("/catalog/") else set()
        if set(query) - allowed or any(len(v) != 1 or not re.fullmatch(r"[1-9][0-9]{0,5}", v[0]) for v in query.values()):
            raise ValueError("Only bounded observed catalog query fields are allowed")


def validate_read_query(body: dict) -> None:
    # These fields are a coordinator-authorized research request, not a proven upstream contract.
    if not isinstance(body, dict) or set(body) - {"ThemeId", "Page", "PerPage"}:
        raise ValueError("Unknown public-list query shape")
    for key, value in body.items():
        ceiling = 100 if key == "PerPage" else 1000000
        if type(value) is not int or not 1 <= value <= ceiling:
            raise ValueError("Public-list query fields must be bounded positive integers")


def resolve_provider_addresses():
    output = queue.Queue(maxsize=1)

    def resolve():
        try:
            addresses = socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)
            output.put((addresses, None))
        except OSError as error:
            output.put((None, error))

    threading.Thread(target=resolve, daemon=True).start()
    try:
        addresses, error = output.get(timeout=DNS_TIMEOUT_SECONDS)
    except queue.Empty as error:
        raise TimeoutError("Provider DNS deadline") from error
    if error:
        raise error
    if not addresses or len(addresses) > 32:
        raise ValueError("Unexpected provider DNS response")
    return tuple(dict.fromkeys((family, sockaddr) for family, _, _, _, sockaddr in addresses))


class PinnedProviderConnection(http.client.HTTPSConnection):
    def __init__(self, addresses):
        context = ssl.create_default_context()
        if not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
            raise ValueError("Strict provider certificate verification is mandatory")
        super().__init__(HOST, port=443, timeout=HTTP_DEADLINE_SECONDS, context=context)
        self.addresses = addresses
        self.cancelled = threading.Event()
        self.deadline = time.monotonic() + HTTP_DEADLINE_SECONDS
        # HTTPConnection clears sock for close-delimited responses; the body still owns it.
        self.live_socket = None

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0 or self.cancelled.is_set():
            raise TimeoutError("Provider request deadline")
        return remaining

    def connect(self):
        family, address = self.addresses[0]
        self.remaining()
        raw = socket.socket(family, socket.SOCK_STREAM)
        self.sock = self.live_socket = raw
        try:
            raw.settimeout(self.remaining())
            raw.connect(address)
            # Publish the SSL socket before the blocking handshake so cancellation
            # shuts down the live fd, rather than the detached raw socket.
            wrapped = self._context.wrap_socket(raw, server_hostname=HOST, do_handshake_on_connect=False)
            self.sock = self.live_socket = wrapped
            wrapped.settimeout(self.remaining())
            wrapped.do_handshake()
            self.remaining()
        except Exception:
            self.live_socket.close()
            raise

    def cancel(self):
        self.cancelled.set()
        sock = self.live_socket
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


@dataclass(frozen=True)
class ProviderResponse:
    status: int
    content_type: str
    body: bytes
    challenge: bool = False


class ProviderTransport:
    def __init__(self):
        self._addresses = None

    def fetch(self, url: str, payload: bytes | None, *, byte_budget=MAX_BYTES, deadline=None):
        if type(byte_budget) is not int or not 1 <= byte_budget <= MAX_BYTES:
            raise ValueError("Invalid provider byte budget")
        request_deadline = min(deadline or float("inf"), time.monotonic() + HTTP_DEADLINE_SECONDS)
        if request_deadline <= time.monotonic():
            raise TimeoutError("Acquisition run deadline")
        validate_provider_url(url)
        if self._addresses is None:
            self._addresses = resolve_provider_addresses()
        parsed = urllib.parse.urlsplit(url)
        if payload is not None:
            if parsed.path not in READ_ONLY_POST_PATHS or len(payload) > 8192:
                raise ValueError("Only bounded observed read-only list POST is allowed")
            validate_read_query(json.loads(payload))
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        connection = PinnedProviderConnection(self._addresses)
        connection.deadline = request_deadline
        timer = threading.Timer(max(0, request_deadline - time.monotonic()), connection.cancel)
        timer.daemon = True
        timer.start()
        deadline = connection.deadline
        headers = {"Host": HOST, "Accept-Encoding": "identity", "User-Agent": "BotAIContentImport/1.0"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        response = None
        try:
            connection.request("POST" if payload is not None else "GET", path, payload, headers)
            response = connection.getresponse()
            body = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or connection.cancelled.is_set():
                    raise TimeoutError("Provider response deadline")
                connection.live_socket.settimeout(remaining)
                chunk = response.read1(min(65536, byte_budget + 1 - len(body)))
                if connection.cancelled.is_set() or time.monotonic() > deadline:
                    raise TimeoutError("Provider response deadline")
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > byte_budget:
                    raise ValueError("Provider response exceeds byte budget")
            expected_length = response.getheader("Content-Length")
            if expected_length is not None and (not expected_length.isdigit() or int(expected_length) != len(body)):
                raise ValueError("Incomplete provider response")
            if response.getheader("Content-Encoding", "identity") not in {"", "identity"}:
                raise ValueError("Unexpected compressed provider response")
            return ProviderResponse(response.status, response.getheader("Content-Type", ""), bytes(body),
                                    response.getheader("cf-mitigated", "").lower() == "challenge")
        finally:
            timer.cancel()
            if response is not None:
                response.close()
            connection.close()
