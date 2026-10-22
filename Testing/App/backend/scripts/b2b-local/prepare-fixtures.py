#!/usr/bin/env python3
"""Validate/copy only the approved server seed pack, excluding presenter labels."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from common import RUNTIME, assert_isolated, private_file

MAXIMA = {14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4}
KINDS = {'statement', 'taskReference', 'studentSolution', 'studentSolutionPdf'}


def strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate seed JSON key')
        result[key] = value
    return result


def load_package(manifest):
    if manifest.is_symlink():
        raise ValueError('Seed manifest symlink forbidden')
    root = manifest.parent.resolve(strict=True)
    raw = manifest.read_bytes()
    source = json.loads(raw, object_pairs_hook=strict_pairs)
    if set(source) != {'version', 'source', 'cases'} or source['version'] != 1:
        raise ValueError('Unsupported seed manifest')
    cases = source['cases']
    if not isinstance(cases, list) or not 1 <= len(cases) <= 1000:
        raise ValueError('Expected 1–1000 approved cases')
    output, assets, ids, counts = [], {}, set(), {number: 0 for number in MAXIMA}
    for case in cases:
        allowed = {'id', 'projectNumber', 'fipiId', 'sourcePage', 'title', 'maxScore', 'files',
                   'statementText', 'statementLatex', 'referenceAnswer', 'referenceAnswerLatex', 'referenceSolution', 'inputMode'}
        if set(case) - allowed or not {'id', 'projectNumber', 'title', 'maxScore', 'files',
                                      'statementText', 'referenceSolution'}.issubset(case):
            raise ValueError('Unexpected seed case shape; presenter metadata must stay separate')
        case_id, number = case['id'], case['projectNumber']
        if (not isinstance(case_id, str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]+', case_id)
                or case_id in ids or type(number) is not int or number not in MAXIMA
                or type(case['maxScore']) is not int or case['maxScore'] != MAXIMA[number]):
            raise ValueError('Invalid case ID/number/score')
        ids.add(case_id)
        counts[number] += 1
        input_mode = case.get('inputMode', 'prepared')
        if input_mode not in ('prepared', 'from-images'):
            raise ValueError('Invalid task input mode')
        text, latex = case['statementText'], case.get('statementLatex')
        answer = case.get('referenceAnswer') or case.get('referenceAnswerLatex')
        if (not isinstance(text, str) or not text.strip() or (input_mode == 'prepared' and (not isinstance(answer, str) or not answer.strip())) or case['referenceSolution'] is not None
                or (latex is not None and (not isinstance(latex, str) or not latex.strip()))):
            raise ValueError('Statement/official answer required; referenceSolution must remain null')
        lines = text.split('\n', 1)
        content = [{'type': 'text', 'value': lines[0]}]
        statement = lines[0]
        if latex:
            content.append({'type': 'latex', 'value': latex})
            statement += '\n\\[' + latex + '\\]'
        if len(lines) == 2:
            content.append({'type': 'text', 'value': lines[1]})
            statement += '\n' + lines[1]
        files = case['files']
        if not isinstance(files, dict) or not {'statement', 'taskReference', 'studentSolution'} <= set(files) or set(files) - KINDS:
            raise ValueError('Only four documented case assets are permitted')
        recorded = {}
        flattened = []
        for kind, values in files.items():
            values = values if isinstance(values, list) else [values]
            if not 1 <= len(values) <= (4 if kind == 'studentSolution' else 1):
                raise ValueError('Invalid asset count')
            for index, relative in enumerate(values):
                flattened.append((kind, index, relative, len(values)))
        for kind, index, relative, count in flattened:
            if not isinstance(relative, str):
                raise ValueError('Invalid seed asset path')
            path = PurePosixPath(relative)
            if path.is_absolute() or '..' in path.parts or str(path) != relative or '\\' in relative:
                raise ValueError('Unsafe seed asset path')
            original = root / relative
            if original.is_symlink() or root not in original.resolve(strict=True).parents:
                raise ValueError('Seed asset must remain inside approved package')
            if any(part.is_symlink() for part in original.parents if part != root and root in part.parents):
                raise ValueError('Seed asset directory symlink forbidden')
            payload = original.read_bytes()
            if not 0 < len(payload) <= 8 * 1024 * 1024:
                raise ValueError('Seed asset exceeds upload budget')
            if kind == 'studentSolutionPdf':
                extension, mime = '.pdf', 'application/pdf'
                valid = payload.startswith(b'%PDF-')
            elif payload.startswith(b'\x89PNG\r\n\x1a\n'):
                extension, mime, valid = '.png', 'image/png', True
            else:
                extension, mime, valid = '.jpg', 'image/jpeg', payload.startswith(b'\xff\xd8\xff')
            if not valid:
                raise ValueError('Unsupported seed asset signature')
            target = case_id + '/' + kind + (f'-{index+1}' if count > 1 else '') + extension
            assets[target] = payload
            item = {'path': target, 'mimeType': mime, 'sizeBytes': len(payload),
                    'sha256': hashlib.sha256(payload).hexdigest()}
            if kind == 'studentSolution' and count > 1:
                recorded.setdefault(kind, []).append(item)
            else:
                recorded[kind] = item
        output.append({'id': case_id, 'taskNumber': number, 'maxScore': MAXIMA[number],
                       'title': case['title'], 'statement': statement, 'content': content,
                       'referenceAnswer': answer, 'referenceSolution': None, 'isDemo': False,
                       'fipiId': case.get('fipiId'), 'sourcePage': case.get('sourcePage'), 'files': recorded,
                       **({'inputMode': input_mode} if input_mode != 'prepared' else {})})
    if manifest.read_bytes() != raw:
        raise ValueError('Source manifest changed during package preparation')
    return {'schemaVersion': 1, 'sourceManifestSha256': hashlib.sha256(raw).hexdigest(),
            'cases': output}, assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    assert_isolated()
    package, assets = load_package(args.manifest.absolute())
    if args.validate_only:
        print('PASS: trusted bounded cases and scoped assets; no presenter data read.')
        return
    target = RUNTIME / 'fixtures-package'
    if target.is_symlink():
        raise ValueError('Seed package symlink forbidden')
    target.mkdir(mode=0o700, exist_ok=True)
    target.chmod(0o700)
    for relative, payload in assets.items():
        path = target / relative
        if path.parent.is_symlink() or path.is_symlink():
            raise ValueError('Private asset symlink forbidden')
        path.parent.mkdir(mode=0o700, exist_ok=True)
        path.parent.chmod(0o700)
        try:
            with path.open('xb') as stream:
                path.chmod(0o600)
                stream.write(payload)
        except FileExistsError:
            if path.read_bytes() != payload:
                raise ValueError('Existing private asset differs; preserved without replacement')
            path.chmod(0o600)
    serialized = json.dumps(package, ensure_ascii=False, indent=2) + '\n'
    manifest = target / 'package.json'
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        current = {case['id']: case for case in package['cases']}
        if any(current.get(case['id']) != case for case in previous['cases']):
            raise ValueError('Existing private case differs; preserved without replacement')
    if manifest.exists():
        temporary = target / '.package-update.json'
        if temporary.exists() or temporary.is_symlink():
            raise ValueError('Package update already pending')
        private_file(temporary, serialized)
        temporary.replace(manifest)
    else:
        private_file(manifest, serialized)
    print('Private B2B package prepared; no registration, DB mutation or AI run.')


if __name__ == '__main__':
    main()
