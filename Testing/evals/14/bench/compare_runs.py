"""Per-place verdicts across repeated runs of several variants (regex places only).

Usage: python compare_runs.py s3 s8 s8t0   (reads runs/out_<variant>_r<n>.json)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from score_reading import KEY, verdict  # noqa: E402

HERE = Path(__file__).parent / 'runs'
SHORT = {'верно': '+', 'исправил': 'И', 'оба': 'о', 'нет': '-'}
variants = sys.argv[1:]
runs = {v: [json.loads(p.read_text(encoding='utf-8')) for p in sorted(HERE.glob(f'out_{v}_r*.json'))] for v in variants}
ids = set.intersection(*(set(r) for v in variants for r in runs[v]))
totals = {v: [0, 0, 0] for v in variants}  # right, corrected, places
print('место'.ljust(28), *(v.ljust(8) for v in variants))
for work in KEY['works']:
    if work['id'] not in ids:
        continue
    for place in work['places']:
        if place['check'] != 'regex':
            continue
        cells = []
        for v in variants:
            marks = ''.join(SHORT[verdict((r[work['id']].get('text') or ''), place)] if r[work['id']].get('text')
                            else 'x' for r in runs[v])
            totals[v][0] += marks.count('+')
            totals[v][1] += marks.count('И') + marks.count('о')
            totals[v][2] += len(marks)
            cells.append(marks.ljust(8))
        print(f'{work["id"]} {place["cat"]}'.ljust(28), *cells)
for v in variants:
    right, corrected, n = totals[v]
    print(f'{v}: верно {right}/{n}, исправил или оба {corrected}, прогонов {len(runs[v])}')
