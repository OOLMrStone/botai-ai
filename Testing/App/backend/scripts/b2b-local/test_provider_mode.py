"""Failure injection for the live-switch boundary; no Docker, private key or model access."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class SwitchFailureTest(unittest.TestCase):
    def profile_scenario(self, limit):
        spec = importlib.util.spec_from_file_location('profile_under_test', Path(__file__).with_name('provider-mode.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='b2b-profile-qa-') as folder:
            module.RUNTIME = Path(folder)
            module.OVERRIDE = module.RUNTIME / 'live.compose.json'
            values = {'provider-key.json': {'apiKey': 'fake-unit-test-key'},
                      'provider-profile.json': {'baseUrl': 'https://api.deepseek.com/v1',
                          'model': 'deepseek-v4-flash', 'timeoutSeconds': 360, 'maxOutputTokens': limit}}
            for name, value in values.items():
                path = module.RUNTIME / name
                path.write_text(json.dumps(value))
                os.chmod(path, 0o600)
            if limit != 32000:
                with self.assertRaisesRegex(RuntimeError, 'authorized local configuration'):
                    module.prepare()
                self.assertFalse(module.OVERRIDE.exists())
                return
            module.prepare()
            env = json.loads(module.OVERRIDE.read_text())['services']['ai']['environment']
            self.assertEqual('32000', env['LLM_MAX_OUTPUT_TOKENS'])
            self.assertEqual('360', env['LLM_TIMEOUT_S'])
            self.assertEqual('0', env['LLM_MAX_RETRIES'])
            self.assertNotIn('LLM_VISION_MAX_OUTPUT_TOKENS', env)
            self.assertEqual(0o600, module.OVERRIDE.stat().st_mode & 0o777)

    def test_reject_old_16000_profile(self): self.profile_scenario(16000)

    def test_prepare_approved_32000_profile(self): self.profile_scenario(32000)

    def scenario(self, failure):
        spec = importlib.util.spec_from_file_location('switch_under_test', Path(__file__).with_name('provider-mode.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='b2b-switch-qa-') as folder:
            root = Path(folder)
            module.RUNTIME, module.MODE, module.SWITCH, module.OVERRIDE = (
                root, root / 'provider-mode.json', root / 'provider-switch.json', root / 'live.compose.json')
            images = {name: 'sha256:' + str(index) * 64 for index, name in enumerate(('ai', 'backend', 'pdf-renderer'), 1)}
            proof = {'schemaVersion': 1, 'securityReviewed': True, 'aiHead': 'a' * 40, 'images': images}
            (root / 'accepted-build.json').write_text(json.dumps(proof))
            (root / 'fixtures.json').write_text('{}')
            (root / 'ai-approval.json').write_text(json.dumps({'approvedHead': 'a' * 40, 'exportManifestSha256': 'digest'}))
            calls, injected = [], False

            def run(command, **kwargs):
                calls.append(command)
                if 'up' in command and command[-1] == 'backend':
                    if failure == 'health':
                        raise subprocess.CalledProcessError(1, command)
                    if failure == 'interrupt':
                        raise KeyboardInterrupt()
                return subprocess.CompletedProcess(command, 0, stdout='', stderr='')

            def write(path, value):
                nonlocal injected
                final_mode = path == module.MODE and value.get('mode') == 'live'
                final_switch = path == module.SWITCH and value.get('state') == 'succeeded'
                if ((failure in ('mode_write', 'all_late_writes') and final_mode)
                        or (failure == 'switch_write' and final_switch)) and not injected:
                    injected = True
                    raise OSError('injected final state write failure')
                if failure == 'all_late_writes' and injected:
                    raise OSError('injected recovery write failure')
                path.write_text(json.dumps(value))

            with (patch.object(module, 'assert_local_docker'), patch.object(module, 'verify_proof', side_effect=lambda p, **kw: p),
                  patch.object(module, 'running_ids', return_value=images), patch.object(module, 'verify_export', return_value='digest'),
                  patch.object(module, 'prepare'), patch.object(module, 'idle'),
                  patch.object(module, 'image_override', side_effect=lambda p, path: path),
                  patch.object(module, 'write_state', side_effect=write), patch.object(module.subprocess, 'run', side_effect=run),
                  contextlib.redirect_stderr(io.StringIO())):
                with self.assertRaises(KeyboardInterrupt if failure == 'interrupt' else (OSError, subprocess.CalledProcessError)):
                    module.apply('live', 'a' * 40)
            self.assertTrue(any('stop' in call and 'ai' in call and 'backend' in call for call in calls))
            self.assertEqual(2, sum(call[:3] == ['docker', 'ps', '-q'] for call in calls))
            self.assertTrue(all('--no-build' in call and '--pull' in call for call in calls if 'up' in call))
            state = json.loads(module.SWITCH.read_text())
            if failure == 'all_late_writes':
                self.assertEqual('switching', state['state'])
            else:
                self.assertEqual('failed_stopped', state['state'])
                self.assertTrue(state['stoppedConfirmed'])
                self.assertEqual('unknown', json.loads(module.MODE.read_text())['mode'])

    def test_backend_health_failure(self): self.scenario('health')
    def test_final_mode_write_failure(self): self.scenario('mode_write')
    def test_final_switch_write_failure(self): self.scenario('switch_write')
    def test_interrupt_after_up(self): self.scenario('interrupt')
    def test_all_recovery_writes_fail_preserves_switching(self): self.scenario('all_late_writes')


if __name__ == '__main__':
    unittest.main()
