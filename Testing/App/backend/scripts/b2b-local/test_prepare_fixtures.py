"""Offline package-shape/security tests; no model, Docker, DB or account calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_fixtures', Path(__file__).with_name('prepare-fixtures.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def package(self, directory, **changes):
        for name in ('task.png', 'reference.png', 'first.png', 'second.png'):
            (directory / name).write_bytes(b'\x89PNG\r\n\x1a\n' + name.encode())
        case = dict(id='fipi-14.1.1', projectNumber=15, title='Задание', maxScore=3,
                    statementText='Условие', referenceAnswer='Ответ', referenceSolution=None,
                    files=dict(statement='task.png', taskReference='reference.png',
                               studentSolution=['first.png', 'second.png']))
        case.update(changes)
        path = directory / 'manifest.json'
        path.write_text(json.dumps(dict(version=1, source='approved', cases=[case])))
        return path

    def test_ordered_multiphoto_and_all_task_maxima(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for number, maximum in module.MAXIMA.items():
                package, assets = module.load_package(self.package(root, projectNumber=number, maxScore=maximum))
                files = package['cases'][0]['files']['studentSolution']
                self.assertEqual(len(files), 2)
                self.assertTrue(assets[files[0]['path']].endswith(b'first.png'))
                self.assertTrue(assets[files[1]['path']].endswith(b'second.png'))

    def test_image_mode_has_no_fabricated_answer_or_score(self):
        with tempfile.TemporaryDirectory() as tmp:
            package, _ = module.load_package(self.package(Path(tmp), inputMode='from-images', referenceAnswer=None))
            case = package['cases'][0]
            self.assertIsNone(case['referenceAnswer'])
            self.assertEqual(case['inputMode'], 'from-images')
            self.assertNotIn('score', case)
            with self.assertRaises(ValueError):
                module.load_package(self.package(Path(tmp), referenceAnswer=None))

    def test_hidden_expected_metadata_and_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                module.load_package(self.package(Path(tmp), expectedScore=2))
            with self.assertRaises(ValueError):
                module.load_package(self.package(Path(tmp), files=dict(statement='../outside.png',
                    taskReference='reference.png', studentSolution='first.png')))


if __name__ == '__main__':
    unittest.main()
