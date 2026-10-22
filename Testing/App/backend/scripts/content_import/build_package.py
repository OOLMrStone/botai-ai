#!/usr/bin/env python3
"""Build a private candidate package from explicit captures/reviews and raster reports."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from acquire import private_directory, private_write
from normalize import decode_json, normalize_capture
from render_svg import read_owned_file


def build_package(captures, reviews, asset_roots, output):
    if output.is_symlink():
        raise ValueError('Package output must be owned')
    private_directory(output)
    if any(output.iterdir()):
        raise ValueError('Package output must be empty')
    if not 1 <= len(captures) <= 1000:
        raise ValueError('Capture batch budget')
    tasks, completeness, identities = [], [], set()
    package_asset_bytes = 0
    for capture_path in captures:
        if capture_path.is_symlink() or capture_path.stat().st_size > 1024 * 1024:
            raise ValueError('Capture file budget')
        raw = capture_path.read_bytes()
        capture = decode_json(raw)
        identity = capture['externalId']
        if identity in identities:
            raise ValueError('Duplicate provider task identity; reconcile memberships before publication')
        identities.add(identity)
        review = reviews[identity]
        bundle, rendered = map(Path, asset_roots[identity])
        source_manifest = decode_json((bundle / 'manifest.json').read_bytes())
        render_report = decode_json((rendered / 'render-report.json').read_bytes())
        lookup = {}
        for source in source_manifest['assets']:
            metadata = next(item for item in render_report['sourceAssets'] if item['sourceName'] == Path(source['path']).name)
            rendered_asset = next(item for item in render_report['assets'] if item['input'] == metadata['sanitizedSha256'] + '.svg')
            lookup[source['url']] = (metadata, rendered_asset)
        assets = {}

        def resolve(url, purpose):
            nonlocal package_asset_bytes
            if url not in lookup:
                raise ValueError('Missing exact source asset')
            metadata, raster = lookup[url]
            digest = raster['sha256']
            if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
                raise ValueError('Invalid raster hash')
            source_name = metadata['sanitizedSha256'] + '.png'
            data = read_owned_file(rendered, source_name, 8 * 1024 * 1024)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Raster hash changed after validation')
            asset_id = ('s-' if purpose == 'statement' else 'r-') + digest[:40]
            relative = f'assets/{purpose}/{digest}.png'
            if asset_id not in assets:
                package_asset_bytes += len(data)
                if package_asset_bytes > 64 * 1024 * 1024 or len(assets) >= 272:
                    raise ValueError('Package asset budget')
                private_write(output / relative, data)
                assets[asset_id] = {'id': asset_id, 'path': relative, 'sha256': digest, 'purpose': purpose}
            return {'id': asset_id, 'heightCssPx': metadata['heightCssPx'], 'widthCssPx': metadata['widthCssPx']}

        record, quality = normalize_capture(raw, review, resolve)
        record['assets'] = list(assets.values())
        tasks.append(record)
        quality.update(assetCount=len(assets), sourceAssetCount=len(lookup),
                       sourceCaptureFile=str(capture_path), sourceBundle=str(bundle), rendererReport=str(rendered / 'render-report.json'))
        completeness.append(quality)
    lines = [json.dumps(task, ensure_ascii=False, separators=(',', ':')).encode() for task in tasks]
    if any(len(line) > 256 * 1024 for line in lines) or sum(map(len, lines)) > 64 * 1024 * 1024:
        raise ValueError('Package JSONL byte budget')
    private_write(output / 'tasks.jsonl', b'\n'.join(lines) + b'\n')
    private_write(output / 'completeness.json', json.dumps({'state': 'candidate', 'records': completeness},
                                                          ensure_ascii=False, indent=2).encode())
    return tasks, completeness


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--captures', type=Path, required=True)
    cli.add_argument('--reviews', type=Path, required=True)
    cli.add_argument('--asset-roots', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    reviews = decode_json(args.reviews.read_bytes())
    assets = decode_json(args.asset_roots.read_bytes())
    tasks, quality = build_package(sorted(args.captures.glob('*.json')), reviews, assets, args.output)
    print(json.dumps({'candidateRecords': len(tasks), 'assets': sum(row['assetCount'] for row in quality)}))


if __name__ == '__main__':
    main()
