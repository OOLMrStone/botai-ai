"""Offline additive receipt persistence; never executes seed main or contacts services."""
import json
from pathlib import Path
import tempfile
import unittest
from seed import persist_receipt

class ReceiptTests(unittest.TestCase):
    def test_additions_atomically_replace_receipt_and_preserve_old_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'receipt.json'
            old = {'id': 'old', 'sha256': 'same', 'objectKey': 'private/old'}
            persist_receipt(path, {'assets': [old]})
            expanded = {'assets': [old, {'id': 'new', 'sha256': 'new'}]}
            persist_receipt(path, expanded)
            self.assertEqual(json.loads(path.read_text()), expanded)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(tmp).iterdir()), [path])

    def test_changed_removed_duplicate_and_symlink_receipts_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'receipt.json'
            old = {'id': 'old', 'sha256': 'same'}
            persist_receipt(path, {'assets': [old]})
            initial = path.read_bytes()
            for assets in ([], [{'id': 'old', 'sha256': 'changed'}], [old, old]):
                with self.assertRaises(RuntimeError):
                    persist_receipt(path, {'assets': assets})
                self.assertEqual(path.read_bytes(), initial)
            link = Path(tmp) / 'link.json'
            link.symlink_to(path)
            with self.assertRaises(RuntimeError):
                persist_receipt(link, {'assets': [old]})
            self.assertEqual(path.read_bytes(), initial)

if __name__ == '__main__':
    unittest.main()
