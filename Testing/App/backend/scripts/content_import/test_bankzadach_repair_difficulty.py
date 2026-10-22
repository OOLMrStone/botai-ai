import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from bankzadach_normalize import PERMISSION, native_difficulty
from bankzadach_repair_difficulty import repair


class NativeDifficultyTest(unittest.TestCase):
    def test_all_five_levels_and_unknown_are_preserved(self):
        for value in [None, 1, 2, 3, 4, 5]:
            self.assertEqual(native_difficulty(value), value)

    def test_normalizer_does_not_collapse_levels_four_and_five(self):
        from bankzadach_normalize import normalize
        class Math:
            def validate_all(self, formulas):pass
        for value in [4, 5]:
            row={'id':'00000000-0000-4000-8000-000000000001','content_latex':'Find $x$.','solution_latex':'$x=1$.','answer':'1','difficulty':value}
            record,quality=normalize(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],None,Math(),'2026-10-06T00:00:00Z','0'*64)
            self.assertEqual(record['difficulty'],value)
            self.assertEqual(quality['difficultyBasis'],'provider-native-1-5')
            self.assertNotIn('isGrob',record)

    def test_malformed_values_are_not_coerced(self):
        for value in [True, False, 1.0, '5', 0, 6, -1, [], {}]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'invalid_source_difficulty'):
                native_difficulty(value)


class DifficultyRepairTest(unittest.TestCase):
    def fixture(self, root):
        raw, baseline = root / 'raw', root / 'baseline'
        (raw / 'details').mkdir(parents=True)
        batch = baseline / 'batch-0001'
        (batch / 'assets' / 'reference').mkdir(parents=True)
        asset = batch / 'assets/reference/example.png'
        asset.write_bytes(b'previously-validated-image-bytes')
        asset_hash = hashlib.sha256(asset.read_bytes()).hexdigest()
        quality, records = [], []
        for index, difficulty in enumerate([1, 2, 3, 4, 5, None], 1):
            identity = f'00000000-0000-4000-8000-{index:012d}'
            data = json.dumps({'id': identity, 'difficulty': difficulty}).encode()
            (raw / 'details' / f'{identity}.json').write_bytes(data)
            quality.append({'externalId': identity, 'rawSha256': hashlib.sha256(data).hexdigest()})
            records.append({'externalId': identity, 'provider': 'bankzadach', 'difficulty': 'medium', 'provenance': {'permissionRef': PERMISSION}, 'content': [{'type': 'text', 'value': 'Exact condition'}], 'referenceSolution': 'Exact solution', 'assets': [{'path': 'assets/reference/example.png', 'sha256': asset_hash}]})
        payload = b'\n'.join(json.dumps(x).encode() for x in records) + b'\n'
        (batch / 'tasks.jsonl').write_bytes(payload)
        (baseline / 'quality.json').write_text(json.dumps(quality))
        (baseline / 'release-audit.json').write_text(json.dumps({'accepted': 6, 'manifests': [{'manifest': 'batch-0001/tasks.jsonl', 'count': 6, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}]}))
        return raw, baseline, records

    def test_only_difficulty_changes_and_asset_bytes_are_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, baseline, before = self.fixture(root)
            output = root / 'replacement'
            report = repair(raw, baseline, output)
            after = [json.loads(x) for x in (output / 'batch-0001/tasks.jsonl').read_text().splitlines()]
            self.assertEqual([x['difficulty'] for x in after], [1, 2, 3, 4, 5, None])
            for old, new in zip(before, after):
                self.assertEqual(dict(old, difficulty=new['difficulty']), new)
            self.assertEqual(report['derivedIsGrobCount'], 1)
            self.assertFalse(report['published'])
            self.assertEqual((baseline / 'batch-0001/assets/reference/example.png').read_bytes(), (output / 'batch-0001/assets/reference/example.png').read_bytes())

    def test_changed_source_capture_is_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, baseline, _ = self.fixture(root)
            next((raw / 'details').glob('*.json')).write_text('{}')
            with self.assertRaisesRegex(ValueError, 'capture_hash_mismatch'):
                repair(raw, baseline, root / 'replacement')
            self.assertFalse((root / 'replacement').exists())

    def test_changed_asset_is_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, baseline, _ = self.fixture(root)
            (baseline / 'batch-0001/assets/reference/example.png').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'baseline_asset_hash'):
                repair(raw, baseline, root / 'replacement')
            self.assertFalse((root / 'replacement').exists())


if __name__ == '__main__':
    unittest.main()
