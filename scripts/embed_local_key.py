#!/usr/bin/env python3
"""Insert a key into final executables, with no secret sidecar or build input."""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.local.launcher import CONFIG_END, CONFIG_START, executable_config


def embed(executable: Path, key: str) -> None:
    if executable.is_symlink() or not executable.is_file():
        raise ValueError('Expected a final executable file')
    with executable.open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 4 * 1024 * 1024))
        has_trailer = CONFIG_END in stream.read()
    if has_trailer:
        raise ValueError('Executable already contains configuration; rebuild before replacing it')
    if not key.startswith('sk-') or any(c.isspace() for c in key):
        raise ValueError('Invalid key format')
    with executable.open('rb') as stream:
        magic = stream.read(4)
    is_macos = magic in {
        b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe',
        b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca',
    }
    if is_macos:
        if sys.platform != 'darwin':
            raise ValueError('macOS executables must be finalized on macOS')
        from PyInstaller.utils.osx import fix_exe_for_code_signing, remove_signature_from_binary
        # Remove the old signature BEFORE appending: codesign rejects data outside
        # the signed Mach-O ranges. There is no secret in the binary at this point.
        remove_signature_from_binary(str(executable))
    payload = json.dumps({'api_key': key}, separators=(',', ':')).encode('utf-8')
    with executable.open('ab') as stream:
        stream.write(CONFIG_START + payload + len(payload).to_bytes(8, 'big') + CONFIG_END)
    if is_macos:
        # This helper opens the final file rb+ and updates only its Mach-O headers;
        # it extends __LINKEDIT/string table to include the trailer in-place.
        fix_exe_for_code_signing(str(executable))
        # Ad-hoc signing updates the final binary only. No credential file or
        # temporary source module is ever supplied to the signing tool.
        subprocess.run(['codesign', '--force', '--sign', '-', str(executable)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['codesign', '--verify', str(executable)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if executable_config(executable).get('api_key') != key:
        raise ValueError('Embedded configuration could not be verified')
    manifest = executable.parent / 'manifest.json'
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding='utf-8'))
        data['files'][executable.name] = hashlib.sha256(executable.read_bytes()).hexdigest()
        manifest.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def contains_key(path: Path, key: bytes) -> bool:
    overlap = b''
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            block = overlap + chunk
            if key in block:
                return True
            overlap = block[-len(key):]
    return False


def scan(roots: list[Path], allowed: set[Path], key: str) -> tuple[int, list[Path], list[Path]]:
    checked, leaks, unreadable = 0, [], []
    seen = set()
    for root in roots:
        for path in root.rglob('*'):
            if path.is_symlink() or not path.is_file():
                continue
            path = path.resolve()
            if path in allowed or path in seen:
                continue
            seen.add(path)
            try:
                if contains_key(path, key.encode('utf-8')):
                    leaks.append(path)
                checked += 1
            except OSError:
                unreadable.append(path)
    return checked, leaks, unreadable


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executables', nargs='+', type=Path)
    parser.add_argument('--scan', action='append', type=Path, dest='roots')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args(argv)
    try:
        executables = [path.resolve(strict=True) for path in args.executables]
        if args.verify_only:
            key = executable_config(executables[0])['api_key']
        else:
            if not sys.stdin.isatty():
                raise ValueError('A terminal with hidden input is required')
            with warnings.catch_warnings():
                # getpass can otherwise fall back to echoed input after a tty
                # error. Treat that fallback as a failure before reading a key.
                warnings.simplefilter('error', getpass.GetPassWarning)
                key = getpass.getpass('DeepSeek key (hidden; final executable only): ')
            for executable in executables:
                embed(executable, key)
        if not key or any(executable_config(path).get('api_key') != key for path in executables):
            raise ValueError('Final executables do not contain the expected key')
        roots = args.roots or [Path(__file__).resolve().parents[1]]
        checked, leaks, unreadable = scan(roots, set(executables), key)
        print(f'Checked {checked} other files; matches outside final executables: {len(leaks)}; unreadable: {len(unreadable)}')
        for path in leaks + unreadable:
            print(path)
        return 1 if leaks or unreadable else 0
    except (OSError, ValueError, KeyError, ImportError, SystemError,
            getpass.GetPassWarning, subprocess.CalledProcessError):
        # Never render an exception which might contain credential input.
        print('Embedding/verification failed. Keep the executable private and inspect the build.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
