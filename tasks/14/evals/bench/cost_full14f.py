"""Cost of the full run: photo-check attempts and tokens per model call kind, from the server log lines."""
import json
import sys
from collections import Counter, defaultdict

rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.startswith('{')]
start = '2026-10-12T22:01:30'
rows = [r for r in rows if r['ts'] >= start]
checks = [r for r in rows if 'photo-check ->' in r['message']]
calls = [r for r in rows if r['message'] == 'llm call']
print('photo-check попыток:', len(checks), Counter(r['status'] for r in checks))
for r in checks:
    if r['status'] != 200:
        print('   не 200:', r['ts'], r['status'], round(r['duration_ms'] / 1000), 'с', r['request_id'])
by = defaultdict(lambda: Counter())
for c in calls:
    k = by[c['llm_kind']]
    k['calls'] += 1
    k['prompt'] += c['prompt_tokens'] or 0
    k['completion'] += c['completion_tokens'] or 0
    k['reasoning'] += c['reasoning_tokens'] or 0
    k['length'] += c['finish_reason'] == 'length'
total = Counter()
for kind, k in by.items():
    print(f'{kind:8} вызовов {k["calls"]:4}  вход {k["prompt"]:8}  выход {k["completion"]:7}  из них рассуждение {k["reasoning"]:7}  обрывов по длине {k["length"]}')
    total.update(k)
print(f'всего    вызовов {total["calls"]:4}  вход {total["prompt"]:8}  выход {total["completion"]:7}  из них рассуждение {total["reasoning"]:7}')
per = defaultdict(Counter)
for c in calls:
    per[c['request_id']]['calls'] += 1
print('вызовов на попытку: мин', min(v['calls'] for v in per.values()), 'макс', max(v['calls'] for v in per.values()))
