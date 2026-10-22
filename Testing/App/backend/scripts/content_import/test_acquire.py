import hashlib
import json
import stat
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from acquire import FetchLedger, MAX_RESPONSE_BYTES, run_manifest, validate_url, private_write
from transport import ProviderResponse


class FixtureTransport:
    def __init__(self, body, status=200, content_type="text/plain"):
        self.body, self.status, self.calls = body, status, 0
        self.content_type = content_type

    def fetch(self, url, payload, **budget):
        self.calls += 1
        if len(self.body) > budget['byte_budget']:
            raise ValueError('Response exceeds byte budget')
        return ProviderResponse(self.status, self.content_type, self.body)


class AcquisitionTests(unittest.TestCase):
    def test_cache_requires_matching_bytes_and_never_sends_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            opener = FixtureTransport(b"public body")
            ledger = FetchLedger(root, opener)
            url = "https://3.shkolkovo.online/catalog/203"
            first = ledger.fetch(url, "section")
            second = ledger.fetch(url, "section")
            self.assertEqual(opener.calls, 1)
            self.assertTrue(second["cached"])
            self.assertEqual(stat.S_IMODE((root / first["path"]).stat().st_mode), 0o600)
            (root / first["path"]).write_bytes(b"changed")
            self.assertIsNone(ledger.cached(url))
            self.assertEqual(FetchLedger(root).latest[url]["sha256"], hashlib.sha256(b"public body").hexdigest())

    def test_error_body_is_recorded_but_never_treated_as_successful_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = FetchLedger(Path(temporary), FixtureTransport(b"temporarily unavailable", 503))
            url = "https://3.shkolkovo.online/catalog/203"
            response = ledger.fetch(url, "section")
            self.assertEqual(response["status"], 503)
            self.assertEqual(response["error"], "http_status")
            self.assertIsNone(ledger.cached(url))
            self.assertTrue((ledger.root / response["path"]).exists())

    def test_unknown_origin_credentials_and_fragments_are_rejected(self):
        for url in ["http://3.shkolkovo.online/catalog", "https://127.0.0.1/task", "https://evil.example/task",
                    "https://user:pass@3.shkolkovo.online/catalog", "https://3.shkolkovo.online:444/catalog",
                    "https://3.shkolkovo.online/catalog#fragment"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_url(url)

    def test_oversized_response_does_not_publish_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = FetchLedger(Path(temporary), FixtureTransport(b"x" * (MAX_RESPONSE_BYTES + 1)))
            result = ledger.fetch("https://3.shkolkovo.online/catalog/203", "section")
            self.assertIn("error", result)
            self.assertNotIn("path", result)

    def test_200_challenge_never_becomes_a_cache_hit_and_stops_batch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / 'requests.jsonl'
            manifest.write_text('\n'.join(json.dumps({'url': f'https://3.shkolkovo.online/catalog/{n}'}) for n in (203, 7814)))
            transport = FixtureTransport(b'<title>Just a moment...</title>', content_type='text/html')
            with patch('acquire.ProviderTransport', return_value=transport):
                result = run_manifest(root, manifest, .5)
            self.assertEqual(transport.calls, 1)
            self.assertEqual(result['stopReason'], 'access_or_rate_limit')
            self.assertEqual(result['success'], 0)
            self.assertIsNone(FetchLedger(root).cached('https://3.shkolkovo.online/catalog/203'))

    def test_any_failed_transfer_stops_without_downloading_next_row(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / 'requests.jsonl'
            manifest.write_text('\n'.join(json.dumps({'url': f'https://3.shkolkovo.online/catalog/{n}'}) for n in (203, 7814)))
            transport = FixtureTransport(b'x' * 5)
            with patch('acquire.ProviderTransport', return_value=transport), patch('acquire.MAX_RUN_BYTES', 4):
                result = run_manifest(root, manifest, .5)
            self.assertEqual(transport.calls, 1)
            self.assertEqual(result['stopReason'], 'acquisition_failure')
            self.assertEqual(result['unprocessed'], 1)

    def test_atomic_private_writer_does_not_follow_predictable_temporary_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            outside = root / 'outside'
            outside.write_bytes(b'unchanged')
            target = root / 'report.json'
            target.with_name('report.json.tmp').symlink_to(outside)
            private_write(target, b'safe')
            self.assertEqual(outside.read_bytes(), b'unchanged')
            self.assertEqual(target.read_bytes(), b'safe')


if __name__ == "__main__":
    unittest.main()
