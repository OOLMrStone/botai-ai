#!/usr/bin/env python3
"""Validate vectors, then render in a bounded offline existing Sharp container."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import struct
import tempfile
import uuid
from acquire import private_directory, private_write
from svg import validate_svg


def read_owned_file(root, name, byte_limit):
    if not re.fullmatch(r'[a-f0-9]{64}\.png|render-report\.json', name):
        raise ValueError('Unexpected renderer output name')
    path = root / name
    metadata = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > byte_limit:
        raise ValueError('Unsafe renderer output file')
    if path.resolve().parent != root.resolve():
        raise ValueError('Renderer output escapes owned directory')
    return path.read_bytes()


def validate_report(output, expected):
    raw = read_owned_file(output, 'render-report.json', 1024 * 1024)
    report = json.loads(raw)
    if not isinstance(report, dict) or set(report) != {'versions', 'assets'}:
        raise ValueError('Invalid renderer report schema')
    if not isinstance(report['versions'], dict) or len(report['versions']) > 64 or any(
            not isinstance(k, str) or not isinstance(v, str) or len(k) > 64 or len(v) > 64
            for k, v in report['versions'].items()):
        raise ValueError('Invalid renderer version inventory')
    assets = report['assets']
    if not isinstance(assets, list) or len(assets) != len(expected):
        raise ValueError('Renderer asset count disagreement')
    seen, pixels, total_bytes = set(), 0, 0
    for asset in assets:
        if not isinstance(asset, dict) or set(asset) != {'input', 'output', 'width', 'height', 'bytes'}:
            raise ValueError('Invalid renderer asset schema')
        name = asset['output']
        if not isinstance(name, str) or name not in expected or name in seen or asset['input'] != name[:-4] + '.svg':
            raise ValueError('Renderer reported an undeclared output')
        seen.add(name)
        for key in ('width', 'height', 'bytes'):
            if type(asset[key]) is not int or asset[key] <= 0:
                raise ValueError('Invalid renderer numeric metadata')
        if max(asset['width'], asset['height']) > 8192 or asset['width'] * asset['height'] > 20000000:
            raise ValueError('Renderer pixel budget')
        data = read_owned_file(output, name, 8 * 1024 * 1024)
        if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
            raise ValueError('Renderer output is not PNG')
        if struct.unpack('>II', data[16:24]) != (asset['width'], asset['height']) or len(data) != asset['bytes']:
            raise ValueError('Renderer PNG metadata disagreement')
        pixels += asset['width'] * asset['height']
        total_bytes += len(data)
        if pixels > 64000000 or total_bytes > 64 * 1024 * 1024:
            raise ValueError('Renderer aggregate budget')
        asset['sha256'] = hashlib.sha256(data).hexdigest()
    if seen != expected:
        raise ValueError('Missing renderer output')
    return report


def render_batch(paths, output: Path, image_id: str):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('An exact existing image ID is required')
    if not 1 <= len(paths) <= 256:
        raise ValueError('SVG batch count budget')
    if output.is_symlink():
        raise ValueError("Renderer output must not be a symlink")
    private_directory(output)
    if any(output.iterdir()):
        raise ValueError('Renderer output must be an empty owned directory')
    with tempfile.TemporaryDirectory(prefix='botai-svg-', dir=output.parent) as temporary:
        input_dir = Path(temporary)
        input_dir.chmod(0o700)
        total_bytes, manifest = 0, []
        for source in paths:
            if source.is_symlink() or source.stat().st_size > 2 * 1024 * 1024:
                raise ValueError('SVG source path or size budget')
            raw = source.read_bytes()
            validated = validate_svg(raw)
            digest = hashlib.sha256(validated.data).hexdigest()
            total_bytes += len(raw)
            if total_bytes > 64 * 1024 * 1024:
                raise ValueError('SVG batch byte budget')
            private_write(input_dir / (digest + '.svg'), validated.data)
            manifest.append({'sourceName': source.name, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                             'sanitizedSha256': digest, 'widthCssPx': validated.width_css_px,
                             'heightCssPx': validated.height_css_px, 'expandedCost': validated.expanded_cost})
        script = Path(__file__).with_name('render-svg.cjs').resolve()
        container_name = 'botai-content-svg-' + uuid.uuid4().hex
        command = ['docker', 'run', '--rm', '--pull', 'never', '--name', container_name, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                   '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', '--pids-limit', '64',
                   '--user', f'{os.getuid()}:{os.getgid()}', '--tmpfs', '/tmp:rw,nosuid,noexec,size=16m',
                   '--mount', f'type=bind,src={input_dir.resolve()},dst=/input,readonly',
                   '--mount', f'type=bind,src={output.resolve()},dst=/output',
                   '--mount', f'type=bind,src={script},dst=/opt/render.cjs,readonly',
                   '--entrypoint', 'node', image_id, '/opt/render.cjs']
        try:
            subprocess.run(command, check=True, timeout=60, capture_output=True)
        finally:
            # Killing the CLI does not kill its container: always clean the owned job.
            subprocess.run(['docker', 'rm', '-f', container_name], timeout=10, capture_output=True)
        report = validate_report(output, {item['sanitizedSha256'] + '.png' for item in manifest})
        report.update(imageId=image_id, sourceAssets=manifest)
        private_write(output / 'render-report.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
        return report


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--input', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    cli.add_argument('--image-id', required=True)
    args = cli.parse_args()
    report = render_batch(sorted(args.input.glob('*.svg')), args.output, args.image_id)
    print(json.dumps({'rendered': len(report['assets']), 'versions': report['versions']}))


if __name__ == '__main__':
    main()
