import json
from pathlib import Path
import tempfile
import unittest
from build_package import build_package
from test_normalize import capture, review


class PackageTests(unittest.TestCase):
    def fixture(self, root):
        raw = json.dumps(capture()).encode()
        paths = []
        for name in ('one.json', 'two.json'):
            p = root / name
            p.write_bytes(raw)
            paths.append(p)
        bundle, rendered = root / 'source', root / 'rendered'
        bundle.mkdir()
        rendered.mkdir()
        (bundle / 'manifest.json').write_text(json.dumps({'assets': []}))
        (rendered / 'render-report.json').write_text(json.dumps({'sourceAssets': [], 'assets': []}))
        return paths, {'123': review(raw)}, {'123': [str(bundle), str(rendered)]}

    def test_plain_package_is_reproducible_and_duplicate_identity_is_not_double_counted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths, reviews, roots = self.fixture(root)
            first = root / 'candidate1'
            second = root / 'candidate2'
            build_package(paths[:1], reviews, roots, first)
            build_package(paths[:1], reviews, roots, second)
            self.assertEqual((first / 'tasks.jsonl').read_bytes(), (second / 'tasks.jsonl').read_bytes())
            with self.assertRaises(ValueError):
                build_package(paths, reviews, roots, root / 'duplicate')


if __name__ == '__main__':
    unittest.main()
