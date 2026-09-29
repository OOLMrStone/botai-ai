#!/usr/bin/env python3
"""Explicitly authorized photo evals; no retries, expected answers stay local.

A started marker is durable before each POST. Resume skips ALL attempted cases,
including uncertain outcomes, so interruption cannot silently cause duplicate spend.
Use a new run name for a deliberately authorized repeat.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import ExitStack
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.grading.validator import ValidationGate
from app.grading.package import package_paths


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def asset(base, relative):
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        raise ValueError(f'Invalid manifest asset: {relative}')
    return path


def load_cases(manifest, selected):
    document = json.loads(manifest.read_text())
    cases = []
    seen = set()
    for entry in document['cases']:
        case_id = entry['id']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', case_id) or case_id in seen or case_id in ('.', '..'):
            raise ValueError(f'Invalid/duplicate case ID: {case_id}')
        seen.add(case_id)
        if selected and case_id not in selected:
            continue
        task = asset(manifest.parent, entry['problem_and_reference_answer'])
        solution_paths = entry['solution'] if isinstance(entry['solution'], list) else [entry['solution']]
        if not 1 <= len(solution_paths) <= 4:
            raise ValueError(f'Expected one to four solution images: {case_id}')
        students = [asset(manifest.parent, p) for p in solution_paths]
        expected_path = asset(manifest.parent, entry['expected'])
        expected = json.loads(expected_path.read_text())
        if type(expected.get('score')) is not int:
            raise ValueError(f'Missing expected integer score: {case_id}')
        inputs = {'task_image': {'path': str(task.relative_to(manifest.parent)), 'sha256': sha(task.read_bytes())},
                  'solution_images': [{'path': str(student.relative_to(manifest.parent)), 'sha256': sha(student.read_bytes())} for student in students],
                  'expected_sha256': sha(expected_path.read_bytes())}
        if entry.get('provenance'):
            inputs['provenance'] = json.loads(asset(manifest.parent, entry['provenance']).read_text())
        cases.append({'id': case_id, 'task': task, 'students': students,
                      'expected': expected, 'inputs': inputs})
    if selected and set(selected) - seen:
        raise ValueError('Unknown cases: ' + ', '.join(sorted(set(selected) - seen)))
    return cases


def summary(directory, cases):
    rows = []
    for case in cases:
        folder = directory / case['id']
        expected = case.get('expected', {})
        if (folder / 'result.json').exists():
            result = json.loads((folder / 'result.json').read_text())
            row = {k: result.get(k) for k in ('id', 'outcome', 'status_code', 'request_id',
                                             'elapsed_seconds', 'expected_score', 'actual_score',
                                             'score_match', 'expected_outcome', 'behavior_match')}
            row['expected_outcome'] = result.get('expected_outcome', expected.get('expected_outcome', 'graded'))
            row['behavior_match'] = result.get('behavior_match', row['outcome'] == row['expected_outcome'])
            # Recompute from the scores so legacy negative-case matches cannot inflate totals.
            row['score_match'] = (row['expected_outcome'] == 'graded' and row['outcome'] == 'graded'
                                  and type(row['actual_score']) is int
                                  and row['actual_score'] == row['expected_score'])
            rows.append(row)
        else:
            rows.append({'id': case['id'], 'outcome': 'uncertain_no_retry' if (folder / 'started.json').exists() else 'not_started',
                         'expected_outcome': expected.get('expected_outcome', 'graded'),
                         'behavior_match': None, 'score_match': False})
    completed = [r for r in rows if r['outcome'] not in ('not_started', 'uncertain_no_retry')]
    graded = [r for r in rows if r['outcome'] == 'graded' and type(r.get('actual_score')) is int]
    ordinary = [r for r in rows if r['expected_outcome'] == 'graded']
    negative = [r for r in rows if r['expected_outcome'] == 'rejected']
    result = {'updated_at': now(), 'total': len(rows), 'completed': len(completed),
              'graded': len(graded), 'score_matches': sum(r.get('score_match') is True for r in rows),
              'expected_graded': len(ordinary), 'expected_rejections': len(negative),
              'graded_ordinary': sum(r['outcome'] == 'graded' for r in ordinary),
              'score_mismatches': sum(r['outcome'] == 'graded' and not r['score_match'] for r in ordinary),
              'correct_rejections': sum(r['outcome'] == 'rejected' for r in negative),
              'graded_instead_of_rejection': sum(r['outcome'] == 'graded' for r in negative),
              'unexpected_rejections': sum(r['outcome'] == 'rejected' for r in ordinary),
              'behavior_matches': sum(r['behavior_match'] is True for r in rows),
              'cases': rows}
    save_json(directory / 'summary.json', result)
    return result


async def run(args):
    manifest = args.manifest.resolve()
    cases = load_cases(manifest, set(args.case))
    if args.dry_run:
        print(json.dumps({'dry_run': True, 'cases': [c['id'] for c in cases], 'count': len(cases),
                          'endpoint': args.endpoint, 'paid_requests': 0}, ensure_ascii=False))
        return
    directory = ROOT / 'output/evals' / args.run_name
    existed = directory.exists()
    if existed and (directory / 'run.json').exists() and not args.resume:
        raise ValueError('Run directory exists; use --resume to skip all attempted cases')
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another process owns this run') from None
        metadata_path = directory / 'run.json'
        identity = {'endpoint': args.endpoint, 'manifest_sha256': sha(manifest.read_bytes()),
                    'cases': [{'id': c['id'], 'inputs': c['inputs']} for c in cases]}
        if metadata_path.exists():
            stored = json.loads(metadata_path.read_text())
            if stored['identity'] != identity:
                raise ValueError('Endpoint, cases or input hashes changed; use a new run name')
        else:
            snapshot = directory / 'snapshot'
            snapshot.mkdir(exist_ok=True)
            hashes = {}
            for relative in [*(str(p.relative_to(ROOT)) for p in package_paths(root=ROOT).values()),
                             'app/grading/session.py', 'app/grading/provider.py', 'app/grading/service.py']:
                source = ROOT / relative
                destination = snapshot / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                hashes[relative] = sha(source.read_bytes())
            shutil.copyfile(manifest, snapshot / 'manifest.json')
            save_json(metadata_path, {'created_at': now(), 'identity': identity,
                                      'local_source_hashes': hashes, 'concurrency': args.concurrency,
                                      'timeout_seconds': 260, 'automatic_retries': 0,
                                      'snapshot_note': 'Local sources; independently verify they match the deployed server.'})
        limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)
        async with httpx.AsyncClient(timeout=httpx.Timeout(260), limits=limits,
                                     transport=httpx.AsyncHTTPTransport(retries=0), follow_redirects=False) as client:
            # Read-only config also establishes the test-user cookie before concurrent POSTs.
            config_response = await client.get(args.endpoint.rstrip('/') + '/config', timeout=15)
            config_response.raise_for_status()
            config = config_response.json()
            safe_config = {k: config.get(k) for k in ('mode', 'model', 'deadline_seconds',
                                                    'max_solution_images', 'max_image_mb', 'test_ids')}
            config_path = directory / 'config.json'
            if config_path.exists() and json.loads(config_path.read_text()) != safe_config:
                raise ValueError('Server configuration changed; use a new run name')
            save_json(config_path, safe_config)
            semaphore = asyncio.Semaphore(args.concurrency)
            async def one(case):
                async with semaphore:
                    folder = directory / case['id']
                    folder.mkdir(exist_ok=True)
                    if (folder / 'started.json').exists() or (folder / 'result.json').exists():
                        print(f"SKIP {case['id']} (already attempted)", flush=True)
                        return
                    save_json(folder / 'expected.json', case['expected'])
                    save_json(folder / 'inputs.json', case['inputs'])
                    shutil.copyfile(case['task'], folder / ('task-image' + case['task'].suffix))
                    for index, student in enumerate(case['students'], 1):
                        suffix = '' if len(case['students']) == 1 else f'-{index:02}'
                        shutil.copyfile(student, folder / ('solution-image' + suffix + student.suffix))
                    save_json(folder / 'started.json', {'id': case['id'], 'started_at': now()})
                    started = time.monotonic()
                    result = {'id': case['id'], 'expected_score': case['expected']['score'],
                              'expected_outcome': case['expected'].get('expected_outcome', 'graded'),
                              'actual_score': None, 'score_match': False, 'request_id': None,
                              'status_code': None, 'outcome': 'transport_error'}
                    print(f"START {case['id']}", flush=True)
                    try:
                        # Only these two image fields leave the runner. No expected metadata.
                        with ExitStack() as stack:
                            task = stack.enter_context(case['task'].open('rb'))
                            files = [('task_image', ('task' + case['task'].suffix, task,
                                      mimetypes.guess_type(case['task'].name)[0] or 'image/png'))]
                            for index, student_path in enumerate(case['students'], 1):
                                student = stack.enter_context(student_path.open('rb'))
                                files.append(('solution_images', (f'solution-{index}' + student_path.suffix,
                                              student, mimetypes.guess_type(student_path.name)[0] or 'image/png')))
                            response = await client.post(args.endpoint, files=files)
                        result.update(status_code=response.status_code, request_id=response.headers.get('x-request-id'))
                        raw = response.content
                        # Preserve exact response bytes even for invalid JSON and HTTP failures.
                        (folder / 'response.txt').write_bytes(raw)
                        try:
                            value = json.loads(raw)
                            (folder / 'response.json').write_bytes(raw)
                        except (ValueError, UnicodeError):
                            value = None
                        result['response_sha256'] = sha(raw)
                        if response.status_code != 200:
                            result['outcome'] = 'http_error'
                        else:
                            errors = ValidationGate().validate(response.text)
                            result['validation_errors'] = errors
                            if errors:
                                result['outcome'] = 'invalid_response'
                            elif value['is_graded']:
                                score = value['grading']['score']
                                result.update(outcome='graded', actual_score=score,
                                              score_match=score == case['expected']['score'] and result['expected_outcome'] == 'graded',
                                              behavior_match=result['expected_outcome'] == 'graded',
                                              score_difference=score - case['expected']['score'])
                            else:
                                result.update(outcome='rejected', rejection_reason=value['rejection_reason'],
                                              behavior_match=result['expected_outcome'] == 'rejected')
                    except httpx.HTTPError as exc:
                        result['transport_error_type'] = type(exc).__name__
                    finally:
                        result.update(elapsed_seconds=round(time.monotonic() - started, 3), finished_at=now())
                        # Cancellation/unknown failures remain uncertain, not silently retryable.
                        if sys.exc_info()[0] is None:
                            save_json(folder / 'result.json', result)
                        summary(directory, cases)
                    print(f"DONE {case['id']} {result['outcome']} actual={result['actual_score']} expected={result['expected_score']}", flush=True)
            await asyncio.gather(*(one(case) for case in cases))
        final = summary(directory, cases)
        print(json.dumps(final, ensure_ascii=False, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-name', required=True)
    parser.add_argument('--endpoint', default='http://127.0.0.1:8766/api/v1/photo-check')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'tasks/16/evals/fipi/manifest.json')
    parser.add_argument('--concurrency', type=int, choices=(1, 2), default=1)
    parser.add_argument('--case', action='append', default=[])
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]+', args.run_name):
        parser.error('run-name must contain only letters, numbers, underscore or dash')
    try:
        asyncio.run(run(args))
    except (ValueError, httpx.HTTPError) as exc:
        parser.exit(1, f'{type(exc).__name__}: {exc}\n')


if __name__ == '__main__':
    main()
