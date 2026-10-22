"""The manual test plan v2 (hypothesis.md) run through the gateway: same model as the reader, reasoning off.

Each step: one picture + one prompt, 5 independent calls (no history). Whole photos are enlarged like the
resolve call (app.grading.reader.enlarged); crops are sent as prepared. Inside the develop container, PYTHONPATH=/srv.
Output: /tmp/bench/manual_out.json, appended after every step.
"""
import asyncio
import base64
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.grading import reader
from app.grading.images import sanitize

ROOT = Path('/tmp/bench/manual')
OUT = Path('/tmp/bench/manual_out.json')
REPEATS = 5

P = {
    'А': 'Перепиши всё, что написано на фрагменте, построчно и символ в символ. Ничего не исправляй, не вычисляй и не дописывай: если в записи ошибка, перепиши как есть.',
    'О': 'Перепиши только строку ответа «б)» с этой фотографии, символ в символ. Ничего не исправляй.',
    'О3': 'Перепиши только строку, которая начинается с «cos x =» (без квадрата), символ в символ. Ничего не исправляй.',
    'З': 'Что зачёркнуто в строке ответа «б)»? И отдельно: перепиши только знаменатель первой дроби в строке «б)».',
    'С': 'Какие символы на картинке? Перепиши их как видишь, ничего не додумывай.',
    'Ф': 'Сколько отдельных цифр стоит под чертой первой дроби в строке «б)»? Ответь числом и перечисли эти цифры.',
    'Г': 'Перепиши всё, что написано на фрагменте, построчно и символ в символ. Это решение ученика, в нём могут быть описки и ошибки, и найти их — главная цель. Пиши ровно то, что видишь. Если запись не следует из соседних строк или выглядит не так, как ты ожидал бы, перепиши её как есть и сразу после строки добавь пометку [ожидалось бы: …]. Ожидание пиши только в пометке, никогда в самой строке.',
    "Г'": 'Перепиши всё, что написано на фрагменте, построчно и символ в символ. Это решение ученика, в нём могут быть описки и ошибки, и найти их — главная цель. Пиши ровно то, что видишь.',
    'Д': 'Перепиши всё, что написано на фрагменте, построчно и символ в символ. Ничего не исправляй, не вычисляй и не дописывай. Перед тем как записать знак отношения, дробь или цифру рядом с π, проверь признаки: у «>» два штриха сходятся в одной точке справа, у «≠» штрихи пересекаются посередине, у «=» два параллельных штриха; сосчитай отдельные знаки под чертой дроби и сравни ширину знаменателя с числителем; палочка той же высоты, что «1» у этого ученика, — это 1, а не помарка; у корня есть галочка и крыша, у «6» внизу замкнутая петля, у «3» нет. Пиши символ по признакам. Если он не следует из соседних строк — перепиши как есть и добавь [ожидалось бы: …].',
}

STEPS = [
    ('0', '2a.png', 'З'), ('1', '2a.png', 'А'), ('2', '2a.png', 'О'), ('3', '5a.png', 'А'),
    ('4', '3a.png', 'А'), ('5', '3a.png', 'О3'), ('6', '5b.png', 'А'), ('7', '6a.png', 'А'),
    ('8', '1a.png', 'А'), ('9', '1d.png', 'А'), ('10', '7a.png', 'С'), ('11', '7b.png', 'С'),
    ('12', '7c.png', 'С'), ('13', '8a.png', 'С'), ('14', '2a.png', 'Ф'),
    ('15', '2a.png', 'Г'), ('15', '2a.png', "Г'"), ('15', '2a.png', 'Д'),
    ('15', '1a.png', 'Г'), ('15', '1a.png', "Г'"), ('15', '1a.png', 'Д'),
    ('16', '4a.png', 'А'), ('16', '4a.png', 'Г'), ('16', '4a.png', 'Д'),
    ('контроль', 'k1.png', 'Г'), ('контроль', 'k2.png', 'Г'),
]
WHOLE = {'2a.png', '3a.png', '5a.png', '5b.png', '6a.png', '1a.png', '4a.png', 'k1.png', 'k2.png'}


def part(name):
    data = (ROOT / name).read_bytes()
    image = sanitize(data)
    if name in WHOLE:
        image = reader.enlarged(image)
    return image.part()


async def main():
    from app.grading.provider import Provider
    s = get_settings().llm
    provider = Provider(s)
    out = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    for step, picture, prompt in STEPS:
        key = f'{step} | {picture} | {prompt}'
        if key in out and len(out[key]) >= REPEATS:
            continue
        image = part(picture)
        answers = []
        for _ in range(REPEATS):
            kwargs = dict(model=s.model, max_tokens=3000,
                          messages=[{'role': 'user', 'content': [{'type': 'text', 'text': P[prompt]}, image]}],
                          extra_body={**(s.extra_body or {}), 'thinking': {'type': 'disabled'}})
            try:
                r = await provider.client.chat.completions.create(**kwargs)
                answers.append(r.choices[0].message.content or '')
            except Exception as exc:  # report and continue; no payloads are logged
                answers.append(f'[ошибка вызова: {type(exc).__name__}]')
        out[key] = answers
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        print(key, 'готово', flush=True)
    await provider.close()
    print('calls', sum(len(v) for v in out.values()), flush=True)


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
