"""Independent literal reader experiment. Runs inside the develop container (uses its model settings).

Modes:
  R1  — whole photo, no task text, thinking disabled
  R1t — whole photo, no task text, thinking as configured
  R2  — three overlapping horizontal strips upscaled x2, no task text, thinking disabled
Input:  /tmp/reader/<case>/solution-image*.png ; output: /tmp/reader/out.json
"""
import asyncio
import base64
import io
import json
import sys
from pathlib import Path

from openai import AsyncOpenAI
from PIL import Image

from app.config import get_settings

PROMPT = ('Перепиши всё, что написано на фотографии рукописного решения, построчно и символ в символ. '
          'Ничего не исправляй, не вычисляй, не упрощай и не дописывай: если в записи ошибка, перепиши её как есть. '
          'Дроби пиши через /, корень — √, число π — π, знаки ≤ ≥ ≠ ⊥ ∥ как на фото. '
          'Зачёркнутое отмечай [зачёркнуто: …], неразборчивое — [неразборчиво: вариант1 | вариант2]. '
          'Рисунок опиши кратко в квадратных скобках вместе со всеми подписями. Верни только расшифровку.')
ROOT = Path('/tmp/reader')


def b64(img):
    buf = io.BytesIO()
    img.convert('RGB').save(buf, format='JPEG', quality=95)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def strips(img):
    w, h = img.size
    step = h / 3
    pad = int(step * 0.15)
    for k in range(3):
        top, bottom = max(0, int(k * step) - pad), min(h, int((k + 1) * step) + pad)
        part = img.crop((0, top, w, bottom))
        yield part.resize((part.width * 2, part.height * 2), Image.LANCZOS)


async def ask(client, model, images, thinking):
    content = [{'type': 'text', 'text': PROMPT}] + [{'type': 'image_url', 'image_url': {'url': b64(i), 'detail': 'high'}} for i in images]
    kwargs = dict(model=model, messages=[{'role': 'user', 'content': content}], max_tokens=8000)
    if not thinking:
        kwargs['extra_body'] = {'thinking': {'type': 'disabled'}}
    try:
        r = await client.chat.completions.create(**kwargs)
        return r.choices[0].message.content or ''
    except Exception as exc:  # report and continue; no payloads are logged
        return f'[ошибка вызова: {type(exc).__name__}]'


async def main():
    s = get_settings().llm
    client = AsyncOpenAI(api_key=s.api_key, base_url=s.base_url, timeout=240, max_retries=0)
    cases = sorted(p for p in ROOT.iterdir() if p.is_dir())
    out = {}
    for case in cases:
        photos = [Image.open(p) for p in sorted(case.glob('solution-image*.png'))]
        res = {}
        res['R1'] = await ask(client, s.model, photos, thinking=False)
        res['R1t'] = await ask(client, s.model, photos, thinking=True)
        parts = []
        for photo in photos:
            for strip in strips(photo):
                parts.append(await ask(client, s.model, [strip], thinking=False))
        res['R2'] = '\n'.join(parts)
        out[case.name] = res
        print(case.name, {k: len(v) for k, v in res.items()}, flush=True)
        (ROOT / 'out.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    await client.close()


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
