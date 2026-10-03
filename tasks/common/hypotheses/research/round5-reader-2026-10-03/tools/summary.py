"""Matches per run prefix and task: match / works, graded, over- and under-scoring."""
import json
import sys
from pathlib import Path

root = Path(r'C:\Users\kosti\Desktop\botai-ai\output\evals')
for run in sys.argv[1:]:
    rows = [json.loads(p.read_text(encoding='utf-8')) for p in (root / run).glob('*/result.json')]
    graded = [r for r in rows if r.get('outcome') == 'graded']
    ok = sum(bool(r.get('score_match')) for r in rows)
    over = sum(r['actual_score'] > r['expected_score'] for r in graded)
    under = sum(r['actual_score'] < r['expected_score'] for r in graded)
    print(f'{run}: {ok}/{len(rows)} совпало, оценено {len(graded)}, выше {over}, ниже {under}')
