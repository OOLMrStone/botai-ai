"""Meaning check of circle descriptions against the reading key. Text only, no photos, reasoning off.

Usage inside the container: python circle_judge.py /tmp/bench/key.json /tmp/bench/out_<variant>.json
Writes /tmp/bench/judge_<variant>.json: {work id: {verdict, why}}.
"""
import asyncio
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.grading.provider import Provider

PROMPT = '''Сравни описание рисунка из расшифровки с эталонным описанием того же рисунка.
Важно только то, что влияет на проверку отбора корней: какие точки отмечены, чем подписана каждая
(значением, номером, буквой или ничем) и к какой точке относится подпись, подписаны ли концы отрезка,
выделена ли дуга. Формулировки, порядок и лишние подробности не важны. Значения, которые в эталоне
выписаны рядом с окружностью, в расшифровке могут стоять отдельными строками: это не расхождение.
Если в расшифровке есть раздел «Рисунки (отдельное чтение)», сравнивай описание оттуда.
Ответь только JSON: {"verdict": "совпадает" | "расходится" | "нет описания", "why": "<одна фраза>"}.
«расходится» — если хотя бы одна существенная деталь передана иначе (например, подписи стоят у
других точек, номера вместо значений, подписанный конец назван неподписанным).'''


async def main(key_path, out_path):
    key = json.loads(Path(key_path).read_text(encoding='utf-8'))
    out = json.loads(Path(out_path).read_text(encoding='utf-8'))
    s = get_settings().llm
    provider = Provider(s)
    result = {}
    for work in key['works']:
        for n, place in enumerate(p for p in work['places'] if p['check'] == 'judge'):
            text = (out.get(work['id']) or {}).get('text') or ''
            ask = f'{PROMPT}\n\n## Эталон\n{place["truth"]}\n\n## Расшифровка\n{text}'
            kwargs = dict(model=s.model, messages=[{'role': 'user', 'content': ask}], max_tokens=2000,
                          response_format={'type': 'json_object'},
                          extra_body={**(s.extra_body or {}), 'thinking': {'type': 'disabled'}})
            try:
                r = await provider.client.chat.completions.create(**kwargs)
                verdict = json.loads(r.choices[0].message.content)
            except Exception as exc:  # report and continue; no payloads are logged
                verdict = {'verdict': 'ошибка', 'why': type(exc).__name__}
            result[f'{work["id"]}#{n}'] = verdict
            print(work['id'], verdict.get('verdict'), '|', verdict.get('why'), flush=True)
    await provider.close()
    target = Path(out_path).with_name(Path(out_path).name.replace('out_', 'judge_'))
    target.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    ok = sum(v.get('verdict') == 'совпадает' for v in result.values())
    print('circle:', ok, '/', len(result), flush=True)


if __name__ == '__main__':
    sys.exit(asyncio.run(main(*sys.argv[1:3])))
