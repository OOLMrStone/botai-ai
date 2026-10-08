#!/usr/bin/env python3
"""Run explicitly authorized, isolated GPT photo evals through Codex CLI.

One fresh context per case. Expected labels are never included in model input.
Durable started markers prevent accidental duplicate inference on resume.
This standalone comparison does not change or run the BotAI service.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.run_photo_evals import load_cases, now, save_json


async def run(args):
    out = args.output.resolve()
    cases = []
    for dataset in ('fipi', 'kostyan'):
        selected = load_cases(ROOT / f'tasks/16/evals/{dataset}/manifest.json', set())
        for case in selected:
            case['dataset'] = dataset
        cases.extend(selected)
    if args.case:
        wanted = set(args.case)
        cases = [c for c in cases if c['id'] in wanted]
        if wanted != {c['id'] for c in cases}:
            raise ValueError('Unknown case IDs')
    config = json.loads((out / 'cli-config.json').read_text())
    prompt = (out / 'prompt.txt').read_text()
    if args.dry_run:
        print(json.dumps({'cases': [c['id'] for c in cases], 'model': args.model,
                          'effort': args.effort, 'inference_calls': 0}))
        return
    destination = out / (args.model + '-' + args.effort)
    destination.mkdir(exist_ok=True)
    identity = {'model': args.model, 'effort': args.effort,
                'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
                'instructions_sha256': hashlib.sha256((out / 'model-instructions.txt').read_bytes()).hexdigest(),
                'config_sha256': hashlib.sha256((out / 'cli-config.json').read_bytes()).hexdigest(),
                'transport': 'codex exec; ChatGPT authentication; fresh ephemeral session',
                'automatic_retries': 0}
    meta = destination / 'run.json'
    if meta.exists():
        if json.loads(meta.read_text())['identity'] != identity:
            raise ValueError('Run configuration changed')
    else:
        save_json(meta, {'created_at': now(), 'identity': identity})
    semaphore = asyncio.Semaphore(args.concurrency)

    async def one(case):
        async with semaphore:
            folder = destination / case['id']
            folder.mkdir(exist_ok=True)
            marker = folder / 'started.json'
            if marker.exists():
                print(f'SKIP {args.model} {case["id"]}: already attempted', flush=True)
                return
            save_json(folder / 'inputs.json', case['inputs'])
            save_json(folder / 'expected.json', case['expected'])
            flags = config | {'model': args.model, 'model_reasoning_effort': args.effort}
            cmd = [shutil.which('codex'), 'exec', '--ignore-user-config', '--ignore-rules',
                   '--ephemeral', '--skip-git-repo-check', '--json', '--color', 'never',
                   '-C', str(out / 'workspace'), '-o', str(folder / 'response.txt')]
            for key, value in flags.items():
                # TOML inline tables are not JSON objects.
                if key == 'skills.config':
                    value = '[' + ','.join('{path=' + json.dumps(v['path']) + ',enabled=false}' for v in value) + ']'
                else:
                    value = json.dumps(value, ensure_ascii=False)
                cmd += ['-c', key + '=' + value]
            for path in [case['task'], *case['students']]:
                cmd += ['-i', str(path)]
            cmd += ['-']
            # No label, verdict, provenance, source-page commentary or old response enters cmd/stdin.
            result = {'id': case['id'], 'dataset': case['dataset'], 'model': args.model,
                      'effort': args.effort, 'outcome': 'uncertain', 'actual_score': None,
                      'expected_score': case['expected']['score'],
                      'expected_outcome': case['expected'].get('expected_outcome', 'graded'),
                      'score_match': False}
            started = time.monotonic()
            save_json(marker, {'started_at': now(), 'model': args.model, 'effort': args.effort})
            print(f'START {args.model} {case["id"]}', flush=True)
            with (folder / 'events.jsonl').open('wb') as events, (folder / 'stderr.log').open('wb') as errors:
                env = {k: v for k, v in os.environ.items()
                       if k not in ('CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE')}
                process = await asyncio.create_subprocess_exec(
                    *cmd, stdin=asyncio.subprocess.PIPE, stdout=events, stderr=errors, env=env)
                try:
                    await asyncio.wait_for(process.communicate(prompt.encode()), timeout=480)
                    result['returncode'] = process.returncode
                    if process.returncode != 0:
                        result['outcome'] = 'execution_error'
                    else:
                        raw = (folder / 'response.txt').read_text()
                        result['outcome'] = 'answered_pending_review' if raw.strip() else 'empty_response'
                        result['response_sha256'] = hashlib.sha256(raw.encode()).hexdigest()
                except asyncio.TimeoutError:
                    process.terminate()
                    await process.wait()
                    result['outcome'] = 'timeout_uncertain_no_retry'
                except (ValueError, KeyError, FileNotFoundError):
                    result['outcome'] = 'invalid_response'
            result.update(finished_at=now(), elapsed_seconds=round(time.monotonic() - started, 3))
            save_json(folder / 'result.json', result)
            print(f'DONE {args.model} {case["id"]} {result["outcome"]} score={result["actual_score"]}', flush=True)

    await asyncio.gather(*(one(case) for case in cases))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', choices=['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra'], required=True)
    parser.add_argument('--effort', choices=['low', 'medium'], required=True)
    parser.add_argument('--case', action='append', default=[])
    parser.add_argument('--concurrency', type=int, choices=[1, 2, 3, 4], default=2)
    parser.add_argument('--dry-run', action='store_true')
    asyncio.run(run(parser.parse_args()))
