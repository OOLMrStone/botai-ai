#!/usr/bin/env python3
"""Verify a dummy credential trailer without changing no-key release artifacts."""
import argparse
from pathlib import Path
import shutil
import sys
import tempfile

from build_local import APP_NAME, ROOT
from embed_local_key import embed, executable_config
from smoke_local_build import smoke_test


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', nargs='?', type=Path)
    args = parser.parse_args()
    name = APP_NAME + ('.exe' if sys.platform == 'win32' else '')
    candidates = [args.executable] if args.executable else list((ROOT / 'dist').glob(f'*/{name}'))
    if len(candidates) != 1:
        parser.error('Specify one native no-key executable')
    source = candidates[0].resolve(strict=True)
    if executable_config(source) != {}:
        parser.error('Refusing to copy an executable that already contains credentials')
    with tempfile.TemporaryDirectory(prefix='botai-dummy-embedded-smoke-') as temporary:
        destination = Path(temporary)
        executable = destination / source.name
        shutil.copy2(source, executable)
        shutil.copytree(source.parent / 'prompts', destination / 'prompts')
        embed(executable, 'sk-ci-mock-only')
        if smoke_test(executable)['key_configured'] is not True:
            raise RuntimeError('Native application did not detect its dummy embedded credential')
    print('Dummy embedded credential, native startup, grading, and validation passed; source unchanged.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
