#!/usr/bin/env python3
"""Build/start only the approved isolated B2B mock backend; frontend owned separately."""
import argparse
import json
import socket
import subprocess
import sys
from common import (ROOT, RUNTIME, PROJECT, COMPOSE, API_PORT, MAIL_PORT, FRONTEND_PORT,
                    assert_isolated, assert_local_docker, verify_export)
from provenance import backend_source, record_build, verify_proof, image_override, running_ids

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--skip-build', action='store_true')
args = parser.parse_args()
assert_isolated()
mode_file = RUNTIME / 'provider-mode.json'
switch = RUNTIME / 'provider-switch.json'
if switch.is_symlink() or (switch.is_file() and json.loads(switch.read_text()).get('state') != 'succeeded'):
    raise SystemExit('Unresolved provider switch; reconcile explicitly before any mock startup.')
if mode_file.is_symlink() or (mode_file.is_file() and json.loads(mode_file.read_text()).get('mode') != 'mock'):
    raise SystemExit('Provider mode is live/unknown; use explicit provider recovery before mock startup.')
approval_file = RUNTIME / 'ai-approval.json'
if approval_file.is_symlink() or not approval_file.is_file():
    raise SystemExit('AI approval missing. Run prepare-ai.py only after source/contract/security acceptance.')
approval = json.loads(approval_file.read_text())
if approval.get('mode') != 'mock' or verify_export(RUNTIME / 'ai-export') != approval.get('exportManifestSha256'):
    raise SystemExit('Approved mock export integrity failure')
assert_local_docker()
subprocess.run([sys.executable, str(ROOT / 'scripts/b2b-local/check.py')], check=True)
ids = subprocess.check_output(['docker', 'ps', '-q', '--filter',
                               'label=com.docker.compose.project=' + PROJECT], text=True).split()
owned = set()
if ids:
    bindings = subprocess.check_output(['docker', 'inspect', '--format',
                                       '{{json .NetworkSettings.Ports}}', *ids], text=True)
    for line in bindings.splitlines():
        for entries in json.loads(line).values():
            owned.update(int(entry['HostPort']) for entry in entries or [])
for port in (API_PORT, MAIL_PORT):
    with socket.socket() as listener:
        if listener.connect_ex(('127.0.0.1', port)) == 0 and port not in owned:
            raise SystemExit(f'Port {port} belongs to another process; existing process preserved.')
subprocess.run([sys.executable, str(ROOT / 'scripts/b2b-local/init.py')], check=True)
command = [str(COMPOSE)]
# These registry-pinned services are not built below. A clean Docker installation
# must fetch them before the immutable --pull never startup.
subprocess.run(command + ['pull', 'postgres', 'garage', 'mailpit'], check=True)
if not args.skip_build:
    before = backend_source()
    for service in ('ai', 'pdf-renderer', 'backend'):
        subprocess.run(command + ['build', service], check=True)
    proof = record_build(before)
else:
    proof = verify_proof(json.loads((RUNTIME / 'build-proof.json').read_text()))
pins = image_override(proof, RUNTIME / 'mock-images.compose.json')
command += ['-f', str(pins)]
subprocess.run(command + ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180',
                          'postgres', 'garage', 'mailpit', 'ai', 'pdf-renderer', 'backend'], check=True)
if running_ids() != proof['images']:
    subprocess.run([str(COMPOSE), 'stop', 'backend', 'ai'], check=False)
    raise SystemExit('Actual image IDs differ from built provenance; owned AI/backend stopped.')
subprocess.run(command + ['exec', '-T', 'garage', '/garage', 'bucket', 'set-quotas', 'botai',
                          '--max-size', '1GiB', '--max-objects', '1000'],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
print(f'B2B API ready on loopback {API_PORT}; Mailpit {MAIL_PORT}. Frontend {FRONTEND_PORT} is managed separately.')
