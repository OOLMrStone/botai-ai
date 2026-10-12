"""Per-work score table across versions (markdown), merging retry runs."""
import json
import sys
from pathlib import Path

root = Path(r'C:\Users\kosti\Desktop\botai-ai\output\evals')
FIPI = {
    '14': [('до правок', ['trial-14', 'full-14']), ('v4', ['v4-14', 'v4retry-14']), ('v5', ['v5-14']),
           ('v6c', ['v6c-14', 'v6cfix-14'])],
    '15': [('до правок', ['trial2-15', 'full-15']), ('v4', ['v4-15']), ('v5', ['v5-15']),
           ('v6c', ['v6c-15', 'v6cfix-15'])],
    '18': [('до правок', ['trial2-18', 'full-18']), ('v4', ['v4-18', 'v4retry-18']), ('v5', ['v5-18']),
           ('v6c', ['v6c-18']), ('v6d', ['v6d-18']), ('v6e*', ['v6e-18'])],
    'Решу ЕГЭ': [('v4', ['reshu-14', 'reshu-15', 'reshu-18']), ('v5', ['v5reshu-14', 'v5reshu-15', 'v5reshu-18']),
                 ('v6c', ['v6creshu-14', 'v6creshu-15', 'v6creshu-18', 'v6cfixreshu-14'])],
}


def load(runs):
    out = {}
    for run in runs:
        for f in (root / run).glob('*/result.json'):
            r = json.loads(f.read_text(encoding='utf-8'))
            if r['id'] not in out or out[r['id']].get('outcome') != 'graded':
                out[r['id']] = r
    return out


def key(i):
    return [int(p) for p in i.split('.')]


lines = []
for task, versions in FIPI.items():
    data = [(name, load(runs)) for name, runs in versions]
    ids = sorted(set().union(*[d.keys() for _, d in data]), key=key)
    exp = {}
    for _, d in data:
        for i, r in d.items():
            exp.setdefault(i, r.get('expected_score'))
    lines.append(f'### {task}' if task == 'Решу ЕГЭ' else f'### Задание {task}')
    lines.append('')
    lines.append('| Работа | Эталон | ' + ' | '.join(n for n, _ in data) + ' |')
    lines.append('| --- | --- | ' + ' | '.join('---' for _ in data) + ' |')
    for i in ids:
        cells = []
        for _, d in data:
            r = d.get(i)
            if r is None:
                cells.append('—')
            elif r.get('outcome') != 'graded':
                cells.append('сбой')
            else:
                cells.append(f"{r['actual_score']}" + ('' if r['score_match'] else ' ✗'))
        lines.append(f'| {i} | {exp[i]} | ' + ' | '.join(cells) + ' |')
    tot = []
    for n, d in data:
        ok = sum(bool(r.get('score_match')) for r in d.values())
        g = sum(r.get('outcome') == 'graded' for r in d.values())
        tot.append(f'{ok}/{len(ids) if n != "v6e*" else len(d)} (оценено {g})')
    lines.append('| **Итого** | | ' + ' | '.join(tot) + ' |')
    lines.append('')
Path(sys.argv[1]).write_text('\n'.join(lines), encoding='utf-8')
print('\n'.join(l for l in lines if 'Итого' in l or l.startswith('###')))
