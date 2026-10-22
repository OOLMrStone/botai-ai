#!/usr/bin/env python3
"""Store a manually entered provider key privately; never enable it or make a call."""
import argparse
import getpass
import json
import sys
from pathlib import Path
from common import RUNTIME, assert_isolated, private_file

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Print presence only; never prompt or show contents')
parser.add_argument('--from-local-executable', type=Path, help='Read an explicitly authorized portable executable without running it')
parser.add_argument('--ai-source', type=Path, help='Trusted AI source containing the documented local loader')
args = parser.parse_args()
assert_isolated()
path = RUNTIME / 'provider-key.json'
if path.is_symlink():
    raise SystemExit('Private provider key symlink forbidden')
if path.exists():
    data = json.loads(path.read_text())
    present = isinstance(data, dict) and isinstance(data.get('apiKey'), str) and bool(data['apiKey'].strip())
    print('Private provider key configured: ' + str(present).lower() + '; existing file preserved, provider still disabled.')
    raise SystemExit(0 if present else 1)
if args.check:
    print('Private provider key configured: false; provider disabled.')
    raise SystemExit(0)
if args.from_local_executable:
    if not args.ai_source:
        parser.error('--ai-source is required with --from-local-executable')
    executable = args.from_local_executable.absolute()
    if executable.is_symlink() or not executable.is_file():
        raise SystemExit('Expected an explicitly authorized final executable')
    sys.path.insert(0, str(args.ai_source.resolve(strict=True)))
    from app.local.launcher import load_config
    previous = sys.executable
    sys.executable, sys.frozen = str(executable), True
    try:
        config = load_config(executable.parent)
        key = config.api_key.get_secret_value().strip()
    finally:
        sys.executable = previous
        del sys.frozen
else:
    if not sys.stdin.isatty():
        raise SystemExit('Interactive terminal required for hidden input; do not pass keys in arguments or chat.')
    key = getpass.getpass('Provider key (hidden, local private file only): ').strip()
if not key or len(key) > 4096 or any(char.isspace() for char in key):
    raise SystemExit('Expected a nonempty provider key without whitespace; nothing saved.')
private_file(path, json.dumps({'schemaVersion': 1, 'apiKey': key}) + '\n')
print('Private provider key stored0600; Compose does not consume this file, live provider remains disabled.')
