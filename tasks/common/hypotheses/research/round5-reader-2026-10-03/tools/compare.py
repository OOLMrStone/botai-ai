"""Compare baseline and round-3 eval runs case by case."""
import json
import sys
from pathlib import Path

root = Path('output/evals')
base = {'14': ['trial-14', 'full-14'], '15': ['trial2-15', 'full-15'], '18': ['trial2-18', 'full-18']}


def load(runs):
    out = {}
    for run in runs:
        for res in (root / run).glob('*/result.json'):
            r = json.loads(res.read_text(encoding='utf-8'))
            out[r['id']] = r
    return out


AFTER = __import__('os').environ.get('AFTER', 'r3')
lines = []
for task in sys.argv[1:]:
    before, after = load(base[task]), load([f'{AFTER}-{task}'])
    ids = sorted(set(before) | set(after), key=lambda x: [int(p) for p in x.split('.')])
    b_ok = sum(1 for i in ids if before.get(i, {}).get('score_match'))
    a_ok = sum(1 for i in ids if after.get(i, {}).get('score_match'))
    done = len(after)
    lines.append(f'## Задание {task}: до {b_ok}/{len(ids)}, после {a_ok}/{done} (готово {done} из {len(ids)})')
    lines.append('')
    lines.append('| Работа | ФИПИ | До | После | Изменение | Время, с |')
    lines.append('| --- | --- | --- | --- | --- | --- |')
    for i in ids:
        b, a = before.get(i, {}), after.get(i)
        exp = b.get('expected_score', a and a.get('expected_score'))
        bs = b.get('actual_score') if b.get('outcome') == 'graded' else b.get('outcome', '—')
        if a is None:
            lines.append(f'| {i} | {exp} | {bs} | … | | |')
            continue
        as_ = a.get('actual_score') if a.get('outcome') == 'graded' else a.get('outcome')
        change = ''
        if a.get('score_match') and not b.get('score_match'):
            change = 'исправлено'
        elif b.get('score_match') and not a.get('score_match'):
            change = 'сломано'
        lines.append(f'| {i} | {exp} | {bs} | {as_} | {change} | {round(a.get("elapsed_seconds") or 0)} |')
    lines.append('')
print('\n'.join(lines))
