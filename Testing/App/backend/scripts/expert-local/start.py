#!/usr/bin/env python3
"""Start only the isolated expert backend; optional frontend is explicit."""
import argparse
import hashlib
import json
import socket
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / 'runtime/expert-local'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--with-frontend', action='store_true')
parser.add_argument('--skip-build', action='store_true')
parser.add_argument('--refresh-ai-export', action='store_true', help='After AI code freeze, export new allowed source; retain previous private export')
args = parser.parse_args()
if args.skip_build and args.refresh_ai_export:
    parser.error('--refresh-ai-export requires image rebuild; omit --skip-build')
subprocess.run(['python3', str(ROOT / 'scripts/expert-local/init.py')], check=True)
ids = subprocess.check_output(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=botai-expert-local'], text=True).split()
owned = set()
if ids:
    port_lines = subprocess.check_output(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', *ids], text=True).splitlines()
    for line in port_lines:
        for bindings in json.loads(line).values():
            owned.update(int(binding['HostPort']) for binding in bindings or [])
for port in [18085, 18026] + ([13003] if args.with_frontend else []):
    with socket.socket() as listener:
        if listener.connect_ex(('127.0.0.1', port)) == 0 and port not in owned:
            raise SystemExit(f'Port {port} is occupied by a different process; leave that process intact.')
ai = RUNTIME / 'ai-export'
if args.refresh_ai_export and ai.exists():
    previous = RUNTIME / ('ai-export-previous-' + str(time.time_ns()))
    ai.rename(previous)
    try:
        subprocess.run(['python3', str(ROOT.parent / 'botai-ai/deploy/build_runtime.py'), str(ai)], check=True)
    except Exception:
        if ai.exists():
            ai.rename(RUNTIME / ('ai-export-failed-' + str(time.time_ns())))
        previous.rename(ai)
        raise
if not (ai / 'manifest.json').exists():
    subprocess.run(['python3', str(ROOT.parent / 'botai-ai/deploy/build_runtime.py'), str(ai)], check=True)
manifest = json.loads((ai / 'manifest.json').read_text())
if manifest.get('schema_version') != 1 or manifest.get('algorithm') != 'sha256':
    raise SystemExit('Unsupported AI export manifest')
for relative, expected_digest in manifest['files'].items():
    path = ai / relative
    if path.is_symlink() or ai.resolve() not in path.resolve().parents or hashlib.sha256(path.read_bytes()).hexdigest() != expected_digest:
        raise SystemExit('AI export file integrity check failed')
command = [str(ROOT / 'scripts/expert-local/compose.sh')]
if args.with_frontend:
    command.extend(['--profile', 'web'])
if not args.skip_build:
    for service in ['ai', 'pdf-renderer', 'backend'] + (['frontend'] if args.with_frontend else []):
        subprocess.run(command + ['build', service], check=True)
services = ['postgres', 'garage', 'mailpit', 'ai', 'pdf-renderer', 'backend'] + (['frontend'] if args.with_frontend else [])
subprocess.run(command + ['up', '-d', '--wait', '--wait-timeout', '180', *services], check=True)
subprocess.run(command + ['exec', '-T', 'garage', '/garage', 'bucket', 'set-quotas', 'botai', '--max-size', '1GiB', '--max-objects', '1000'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
print('Expert-local API ready on loopback 18085; Mailpit 18026. Existing stacks and data preserved.')
