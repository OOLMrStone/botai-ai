#!/usr/bin/env python3
"""Prepare an offline difficulty-only replacement package from a verified release.

No fetching, rendering, classification, content editing or database publication.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath

from acquire import private_directory, private_write
from bankzadach_normalize import PERMISSION, load_json, native_difficulty


def digest(data):
    return hashlib.sha256(data).hexdigest()


def local_file(root, relative):
    value = PurePosixPath(relative)
    if value.is_absolute() or not value.parts or any(x in {'.', '..'} for x in value.parts) or '\\' in relative:
        raise ValueError('unsafe_package_path')
    path = root
    for part in value.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('symlink_package_path')
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('missing_package_file')
    return path


def repair(raw_root, baseline, output):
    if output.exists() and any(output.iterdir()):
        raise ValueError('output_not_empty')
    audit = load_json(baseline / 'release-audit.json')
    quality_rows = load_json(baseline / 'quality.json')
    quality = {x['externalId']: x for x in quality_rows}
    if len(quality) != len(quality_rows):
        raise ValueError('duplicate_quality_identity')
    seen, levels, sources, batches = set(), Counter(), [], []
    # Validate every record and asset before creating the replacement package.
    assets, prepared = {}, []
    for entry in audit['manifests']:
        manifest = local_file(baseline, entry['manifest'])
        data = manifest.read_bytes()
        if digest(data) != entry['sha256'] or len(data) != entry['bytes']:
            raise ValueError('baseline_manifest_hash')
        rows = [json.loads(line) for line in data.splitlines()]
        if len(rows) != entry['count'] or not 1 <= len(rows) <= 1000:
            raise ValueError('baseline_manifest_count')
        result = []
        for record in rows:
            identity = record['externalId']
            if identity in seen or identity not in quality:
                raise ValueError('duplicate_or_unreviewed_identity')
            if record['provider'] != 'bankzadach' or record['provenance']['permissionRef'] != PERMISSION:
                raise ValueError('wrong_provider_or_grant')
            seen.add(identity)
            capture = local_file(raw_root, 'details/' + identity + '.json')
            raw_bytes = capture.read_bytes()
            raw_hash = digest(raw_bytes)
            if raw_hash != quality[identity]['rawSha256']:
                raise ValueError('capture_hash_mismatch')
            raw = load_json(capture)
            if raw.get('id') != identity:
                raise ValueError('capture_identity_mismatch')
            value = native_difficulty(raw.get('difficulty'))
            replacement = dict(record, difficulty=value)
            if {k: v for k, v in replacement.items() if k != 'difficulty'} != {k: v for k, v in record.items() if k != 'difficulty'}:
                raise ValueError('non_difficulty_change')
            levels['unknown' if value is None else str(value)] += 1
            sources.append((identity, raw_hash))
            for asset in record['assets']:
                source = local_file(manifest.parent, asset['path'])
                target = str(PurePosixPath(entry['manifest']).parent / asset['path'])
                if target not in assets:
                    payload = source.read_bytes()
                    if digest(payload) != asset['sha256']:
                        raise ValueError('baseline_asset_hash')
                    assets[target] = (source, asset['sha256'])
                elif assets[target][1] != asset['sha256']:
                    raise ValueError('asset_path_conflict')
            result.append(json.dumps(replacement, ensure_ascii=False, separators=(',', ':')).encode())
        payload = b'\n'.join(result) + b'\n'
        batches.append({'manifest': entry['manifest'], 'count': len(result), 'bytes': len(payload), 'sha256': digest(payload), 'baselineSha256': entry['sha256']})
        prepared.append((entry['manifest'], payload))
    if len(seen) != audit['accepted'] or seen != quality.keys():
        raise ValueError('accepted_identity_set_mismatch')
    private_directory(output)
    for relative, (source, expected) in assets.items():
        data = source.read_bytes()
        if digest(data) != expected:
            raise ValueError('asset_changed_during_copy')
        private_write(output / relative, data)
    for relative, payload in prepared:
        private_write(output / relative, payload)
    report = {
        'kind': 'bankzadach-native-difficulty-repair.v1',
        'baselinePackage': str(baseline.resolve()),
        'accepted': len(seen),
        'manifests': batches,
        'difficultyDistribution': dict(sorted(levels.items())),
        'derivedIsGrobCount': levels['5'],
        'changedRecordFields': ['difficulty'],
        'contentAndProvenanceUnchanged': True,
        'assetsVerifiedUnchanged': len(assets),
        'sourceCapturesSha256': digest(json.dumps(sorted(sources), separators=(',', ':')).encode()),
        'isGrobPolicy': 'Derived by backend iff difficulty is exactly 5; not an input field.',
        'published': False,
    }
    private_write(output / 'repair-audit.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-root', required=True, type=Path)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(repair(args.raw_root, args.baseline, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
