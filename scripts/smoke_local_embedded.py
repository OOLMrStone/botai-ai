#!/usr/bin/env python3
"""Verify a dummy credential trailer without changing no-key release artifacts."""
import argparse
from pathlib import Path
import shutil
import sys
import tempfile
import time

from build_local import APP_NAME, ROOT
from embed_local_key import embed, executable_config
from smoke_local_build import smoke_test
from app.grading.package import MAX_SCORES, package_paths


def cleanup_with_retry(directory) -> None:
    """Wait briefly for Windows executable/antivirus handles to be released."""
    deadline = time.monotonic() + 10
    while True:
        try:
            directory.cleanup()
            return
        except PermissionError:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(0.2, remaining))


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
    temporary = tempfile.TemporaryDirectory(prefix='botai-dummy-embedded-smoke-')
    try:
        destination = Path(temporary.name)
        executable = destination / source.name
        shutil.copy2(source, executable)
        for number in MAX_SCORES:
            paths = package_paths(number, root=source.parent).values()
            if not all(prompt.is_file() for prompt in paths):
                continue
            for prompt in paths:
                target = destination / prompt.relative_to(source.parent)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(prompt, target)
        embed(executable, 'sk-ci-mock-only')
        if smoke_test(executable)['key_configured'] is not True:
            raise RuntimeError('Native application did not detect its dummy embedded credential')
        print('Dummy embedded credential, native startup, grading, and validation passed.', flush=True)
    finally:
        cleanup_with_retry(temporary)
    print('Temporary embedded executable removed; source unchanged.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
