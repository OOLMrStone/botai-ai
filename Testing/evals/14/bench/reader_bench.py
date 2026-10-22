"""Reader-only benchmark on the task-14 dev works. Runs inside the develop container with PYTHONPATH=/srv.

Uses the deployed reader (app.grading.reader) and provider, so the baseline is exactly what grading uses.
One factor can be changed per variant through environment variables:
  BENCH_VARIANT   name of the run, output goes to /tmp/bench/out_<variant>.json
  BENCH_PROMPT    file replacing the strip prompt (default: reader_prompt(package))
  BENCH_RESOLVE   file replacing the resolve prompt, or 'off' to skip the resolve call
  BENCH_SCALE     MAX_SCALE override, BENCH_STRIPS  STRIPS override
  BENCH_ONLY      comma-separated work ids
  BENCH_CIRCLE    file with a prompt for one more call on the whole photos that describes only the figures
  BENCH_TEMP      temperature for every call (default: not sent, the gateway default)
  BENCH_SKIP_READ skip the strips and the resolve call (to test the figure call alone)
Input: /tmp/bench/cases/<work id>/solution.png. Output keeps text and token counts per work; no payloads are logged.
"""
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

from app.config import get_settings
from app.grading import reader
from app.grading.images import sanitize
from app.grading.package import load_package
from app.grading.provider import Provider

ROOT = Path('/tmp/bench')
VARIANT = os.environ.get('BENCH_VARIANT', 'base')
OUT = ROOT / f'out_{VARIANT}.json'


class Usage(logging.Handler):
    def __init__(self):
        super().__init__()
        self.calls = []

    def emit(self, record):
        if record.getMessage() == 'llm call':
            self.calls.append({k: getattr(record, k, None) for k in
                               ('llm_kind', 'finish_reason', 'prompt_tokens', 'completion_tokens', 'duration_ms')})


async def main():
    if os.environ.get('BENCH_SCALE'):
        reader.MAX_SCALE = float(os.environ['BENCH_SCALE'])
    if os.environ.get('BENCH_STRIPS'):
        reader.STRIPS = int(os.environ['BENCH_STRIPS'])
    package = load_package(14)
    prompt = reader.reader_prompt(package)
    if os.environ.get('BENCH_PROMPT'):
        prompt = Path(os.environ['BENCH_PROMPT']).read_text(encoding='utf-8')
    resolve = reader.resolve_prompt(package)
    if os.environ.get('BENCH_RESOLVE') == 'off':
        resolve = None
    elif os.environ.get('BENCH_RESOLVE'):
        resolve = Path(os.environ['BENCH_RESOLVE']).read_text(encoding='utf-8')

    circle = Path(os.environ['BENCH_CIRCLE']).read_text(encoding='utf-8') if os.environ.get('BENCH_CIRCLE') else None

    usage = Usage()
    logger = logging.getLogger('app.grading.provider')
    logger.addHandler(usage)
    logger.setLevel(logging.INFO)

    provider = Provider(get_settings().llm)
    if os.environ.get('BENCH_TEMP'):
        create = provider.client.chat.completions.create

        async def with_temperature(**kwargs):
            return await create(**kwargs, temperature=float(os.environ['BENCH_TEMP']))
        provider.client.chat.completions.create = with_temperature
    only = set(filter(None, os.environ.get('BENCH_ONLY', '').split(',')))
    out = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    cases = sorted(p for p in (ROOT / 'cases').iterdir() if p.is_dir() and (not only or p.name in only))
    for case in cases:
        if case.name in out and out[case.name].get('text'):
            continue
        images = [sanitize(p.read_bytes()) for p in sorted(case.glob('solution*.png'))]
        usage.calls = []
        started = time.monotonic()
        if os.environ.get('BENCH_SKIP_READ'):
            text = '(обычное чтение пропущено)'
        else:
            text = await reader.read_photos(provider, images, prompt, resolve)
        if text and circle:
            whole = [reader.enlarged(image).part() for image in images]
            try:
                figure = await provider.transcribe(circle, *whole)
            except Exception:  # keep the transcript without the figure call
                figure = ''
            if figure.strip():
                text += '\n\n## Рисунки (отдельное чтение)\n' + figure.strip()
        out[case.name] = {'text': text, 'seconds': round(time.monotonic() - started), 'calls': usage.calls}
        print(case.name, 'ok' if text else 'FAILED', len(text or ''), len(usage.calls), 'calls',
              out[case.name]['seconds'], 's', flush=True)
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    await provider.close()
    total = [c for w in out.values() for c in w['calls']]
    print('works', len(out), 'calls', len(total), 'prompt', sum(c['prompt_tokens'] or 0 for c in total),
          'completion', sum(c['completion_tokens'] or 0 for c in total), flush=True)


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
