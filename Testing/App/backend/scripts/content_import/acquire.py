#!/usr/bin/env python3
"""Fetch observed public source URLs without browser cookies or authentication."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import time
import tempfile
import urllib.parse

from transport import MAX_BYTES, ProviderTransport, READ_ONLY_POST_PATHS, validate_provider_url, validate_read_query
from datetime import datetime, timezone
from pathlib import Path

PROVIDER = "shkolkovo"
MAX_RESPONSE_BYTES = MAX_BYTES
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_MANIFEST_ROWS = 250
MAX_RUN_BYTES = 64 * 1024 * 1024
MIN_PAUSE_SECONDS = 0.5
MAX_LEDGER_BYTES = 16 * 1024 * 1024
MAX_RUN_SECONDS = 300
STOP_STATUSES = frozenset({401, 403, 429})


def validate_url(url: str) -> None:
    validate_provider_url(url)


def private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def private_write(path: Path, data: bytes) -> None:
    private_directory(path.parent)
    descriptor, name = tempfile.mkstemp(prefix='.botai-write-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as out:
            out.write(data)
        os.chmod(temporary, 0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)



class FetchLedger:
    def __init__(self, root: Path, transport=None):
        private_directory(root)
        self.root = root
        self.ledger_path = root / "fetch-ledger.jsonl"
        self.latest = {}
        self.transport = transport or ProviderTransport()
        if self.ledger_path.exists():
            if self.ledger_path.stat().st_size > MAX_LEDGER_BYTES:
                raise ValueError("Ledger exceeds byte budget; use a new resumable batch")
            for line_number, line in enumerate(self.ledger_path.read_text().splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    self.latest[record.get("requestKey", record["url"])] = record
                except (json.JSONDecodeError, KeyError, TypeError) as error:
                    raise ValueError(f"Invalid ledger line {line_number}") from error

    def cached(self, request_key: str):
        record = self.latest.get(request_key)
        if not record or record.get("status") != 200 or record.get("error") or not record.get("path"):
            return None
        path = self.root / record["path"]
        if (path.is_symlink() or not path.resolve().is_relative_to(self.root.resolve())
                or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != record.get("sha256")):
            return None
        return record

    def record(self, record: dict) -> None:
        line = (json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n").encode()
        if self.ledger_path.exists() and self.ledger_path.stat().st_size + len(line) > MAX_LEDGER_BYTES:
            raise ValueError("Ledger exceeds byte budget")
        with os.fdopen(os.open(self.ledger_path, os.O_APPEND | os.O_WRONLY | os.O_CREAT, 0o600), "ab") as out:
            out.write(line)
        os.chmod(self.ledger_path, 0o600)
        self.latest[record.get("requestKey", record["url"])] = record

    def fetch(self, url: str, kind: str, body: dict | None = None, *, byte_budget=MAX_BYTES, deadline=None):
        validate_url(url)
        payload = None
        request_key = url
        if body is not None:
            if urllib.parse.urlsplit(url).path not in READ_ONLY_POST_PATHS:
                raise ValueError("POST is restricted to observed public read-only list APIs")
            validate_read_query(body)
            payload = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
            request_key = "POST " + url + " " + hashlib.sha256(payload).hexdigest()
        cached = self.cached(request_key)
        if cached:
            return {**cached, "cached": True}
        record = {
            "schemaVersion": "botai-acquisition.v1", "provider": PROVIDER,
            "url": url, "kind": kind, "requestKey": request_key,
            "method": "POST" if payload is not None else "GET",
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        }
        if payload is not None:
            record["requestBody"] = body
        try:
            response = self.transport.fetch(url, payload, byte_budget=byte_budget, deadline=deadline)
            downloaded = response.body
            record.update(status=response.status, contentType=response.content_type)
            body = downloaded
            if len(body) > byte_budget:
                raise ValueError("Response exceeds the acquisition byte limit")
            prefix = body[:65536].lower()
            challenge = response.challenge or ("html" in response.content_type.lower() and
                        any(marker in prefix for marker in (b'<title>just a moment', b'<title>attention required',
                                                           b'cf-chl-', b'challenge-platform')))
            digest = hashlib.sha256(body).hexdigest()
            relative = Path("objects") / (digest + ".raw")
            private_write(self.root / relative, body)
            record.update(path=str(relative), sha256=digest, bytes=len(body))
            if challenge:
                record["error"] = "access_challenge"
            elif record["status"] != 200:
                record["error"] = "http_status"
        except (OSError, ValueError, http.client.HTTPException) as error:
            # Upstream status lines/errors are not copied into operator logs.
            record.update(error=type(error).__name__)
        self.record(record)
        return record


def run_manifest(root: Path, manifest: Path, pause_seconds: float):
    deadline = time.monotonic() + MAX_RUN_SECONDS
    ledger = FetchLedger(root)
    if manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Manifest exceeds byte budget")
    rows = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
    if len(rows) > MAX_MANIFEST_ROWS:
        raise ValueError("Manifest exceeds request budget; split into resumable batches")
    observed = set()
    results = []
    downloaded_bytes = 0
    stop_reason = None
    for row in rows:
        if time.monotonic() >= deadline:
            stop_reason = "run_deadline"
            break
        if downloaded_bytes >= MAX_RUN_BYTES:
            stop_reason = "run_byte_budget"
            break
        url = row["url"]
        identity = (url, json.dumps(row.get("body"), sort_keys=True))
        if identity in observed:
            continue
        observed.add(identity)
        result = ledger.fetch(url, row.get("kind", "public-source"), body=row.get("body"),
                              byte_budget=min(MAX_BYTES, MAX_RUN_BYTES - downloaded_bytes), deadline=deadline)
        results.append(result)
        downloaded_bytes += 0 if result.get("cached") else result.get("bytes", 0)
        if result.get("status") in STOP_STATUSES or result.get("error") == "access_challenge":
            stop_reason = "access_or_rate_limit"
            break
        if result.get("error"):
            stop_reason = "acquisition_failure"
            break
        if downloaded_bytes >= MAX_RUN_BYTES:
            stop_reason = "run_byte_budget"
            break
        if not result.get("cached"):
            time.sleep(min(max(MIN_PAUSE_SECONDS, pause_seconds), max(0, deadline - time.monotonic())))
    return {"requested": len(observed), "success": sum(row.get("status") == 200 and not row.get("error") for row in results),
            "failed": sum(row.get("status") != 200 or bool(row.get("error")) for row in results),
            "cached": sum(bool(row.get("cached")) for row in results), "downloadedBytes": downloaded_bytes,
            "stopReason": stop_reason, "unprocessed": len(rows) - len(results)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="JSONL observed {url,kind} records")
    parser.add_argument("--root", type=Path, default=Path("runtime/content-import/raw"))
    parser.add_argument("--pause", type=float, default=0.5)
    args = parser.parse_args()
    if not MIN_PAUSE_SECONDS <= args.pause <= 60:
        parser.error("pause must be between 0.5 and 60 seconds")
    result = run_manifest(args.root, args.manifest, args.pause)
    print(json.dumps(result))
    raise SystemExit(0 if not result["failed"] else 1)


if __name__ == "__main__":
    main()
