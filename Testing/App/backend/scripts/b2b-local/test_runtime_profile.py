"""Offline checks for isolated profiles, cold startup and source provenance."""
import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import common
import provenance


class RuntimeProfileTests(unittest.TestCase):
    def profile(self, name):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('common.py')), '--shell-profile'],
                              env={**os.environ, 'B2B_LOCAL_INSTANCE': name}, capture_output=True, text=True)

    def test_profiles_have_separate_project_storage_and_ports(self):
        default = self.profile('default')
        partner = self.profile('partner-check')
        self.assertEqual(default.returncode, 0)
        self.assertEqual(partner.returncode, 0)
        for value in ('botai-b2b-local-partner-check', 'runtime/b2b-local-partner-check', '13014', '18096', '18037'):
            self.assertIn(value, partner.stdout)
            self.assertNotIn(value, default.stdout)
        for value in ('13004', '18086', '18027'):
            self.assertIn(value, default.stdout)

    def test_unknown_profile_rejected_before_any_output(self):
        result = self.profile('../production')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_renderer_inputs_are_bound_but_generated_builds_are_not(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(provenance, 'ROOT', Path(folder)):
            root = Path(folder)
            renderer = root / 'renderer/pdf'
            renderer.mkdir(parents=True)
            source = renderer / 'Dockerfile'
            source.write_text('source-v1')
            before = provenance.backend_source()
            (renderer / 'build').mkdir()
            (renderer / 'build/output.jar').write_bytes(b'generated')
            self.assertEqual(before, provenance.backend_source())
            source.write_text('source-v2')
            self.assertNotEqual(before, provenance.backend_source())

    def test_cold_start_pulls_infrastructure_before_immutable_start(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'ai-approval.json').write_text(json.dumps({'mode': 'mock', 'exportManifestSha256': 'digest'}))
            commands = []
            socket = MagicMock()
            socket.__enter__.return_value.connect_ex.return_value = 1
            proof = {'images': {}}
            with (patch.object(common, 'RUNTIME', root), patch.object(common, 'assert_isolated'),
                  patch.object(common, 'assert_local_docker'), patch.object(common, 'verify_export', return_value='digest'),
                  patch.object(provenance, 'backend_source', return_value='source'),
                  patch.object(provenance, 'record_build', return_value=proof),
                  patch.object(provenance, 'image_override', return_value=root / 'mock-images.compose.json'),
                  patch.object(provenance, 'running_ids', return_value={}),
                  patch('socket.socket', return_value=socket), patch.object(sys, 'argv', ['start.py']),
                  patch('subprocess.check_output', return_value=''),
                  patch('subprocess.run', side_effect=lambda command, **kw: commands.append(command))):
                runpy.run_path(str(Path(__file__).with_name('start.py')), run_name='__main__')
            pull = next(i for i, command in enumerate(commands) if command[1:2] == ['pull'])
            self.assertEqual(commands[pull][-3:], ['postgres', 'garage', 'mailpit'])
            start = next(i for i, command in enumerate(commands) if 'up' in command)
            self.assertLess(pull, start)
            self.assertIn('--no-build', commands[start])
            self.assertIn('never', commands[start])

    def test_ai_export_supports_backend_nested_inside_clean_ai_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)
            runtime = source / 'Testing/App/backend/runtime/b2b-local'
            runtime.mkdir(parents=True)
            (source / 'deploy').mkdir()
            exporter = source / 'deploy/build_runtime.py'
            exporter.write_text('''import hashlib, json, sys
from pathlib import Path
source = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).resolve()
assert source not in output.parents and source != output
files = {}
for name in ('Dockerfile', 'requirements.txt'):
    content = name.encode()
    (output / name).write_bytes(content)
    files[name] = hashlib.sha256(content).hexdigest()
(output / 'manifest.json').write_text(json.dumps({'schema_version': 1, 'algorithm': 'sha256', 'files': files}))
''')
            head = 'a' * 40
            with (patch.object(common, 'RUNTIME', runtime), patch.object(common, 'assert_isolated'),
                  patch.object(sys, 'argv', ['prepare-ai.py', '--source', str(source), '--approved-head', head]),
                  patch('subprocess.check_output', side_effect=[head, '', head, ''])):
                runpy.run_path(str(Path(__file__).with_name('prepare-ai.py')), run_name='__main__')
            approval = json.loads((runtime / 'ai-approval.json').read_text())
            self.assertEqual(approval['approvedHead'], head)
            self.assertEqual(common.verify_export(runtime / 'ai-export'), approval['exportManifestSha256'])


if __name__ == '__main__':
    unittest.main()
