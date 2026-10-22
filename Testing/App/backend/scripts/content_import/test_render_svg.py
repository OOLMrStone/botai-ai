import json
from pathlib import Path
import struct
import tempfile
import unittest
from render_svg import validate_report

NAME = 'a' * 64 + '.png'
PNG = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 1, 2)


def report(root, name=NAME):
    data = {'versions': {'sharp': '0.35.5'}, 'assets': [{'input': NAME[:-4] + '.svg', 'output': name,
                                                      'width': 1, 'height': 2, 'bytes': len(PNG)}]}
    (root / 'render-report.json').write_text(json.dumps(data))


class RenderBoundaryTests(unittest.TestCase):
    def test_declared_png_is_hashed_after_header_dimensions_check(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / NAME).write_bytes(PNG)
            report(root)
            self.assertEqual(len(validate_report(root, {NAME})['assets'][0]['sha256']), 64)

    def test_report_traversal_and_symlinks_never_reach_host_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report(root, '../secret.png')
            with self.assertRaises(ValueError):
                validate_report(root, {NAME})
            report(root)
            (root / NAME).symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                validate_report(root, {NAME})
            (root / 'render-report.json').unlink()
            (root / 'render-report.json').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                validate_report(root, {NAME})

    def test_missing_or_mismatched_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report(root)
            (root / NAME).write_bytes(PNG.replace(struct.pack('>II', 1, 2), struct.pack('>II', 2, 3)))
            with self.assertRaises(ValueError):
                validate_report(root, {NAME})
            with self.assertRaises(ValueError):
                validate_report(root, {NAME, 'b' * 64 + '.png'})


if __name__ == '__main__':
    unittest.main()
