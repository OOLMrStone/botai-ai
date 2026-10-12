"""Score literal readers on the doubtful places. R0 = ocr from the existing graded run."""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
EVALS = Path(r'C:\Users\kosti\Desktop\botai-ai\output\evals')
SUB = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')


def norm(text):
    text = (text or '').translate(SUB).replace('Π', 'π').replace('\\pi', 'π')
    text = re.sub(r'\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}', r'\1/\2', text)
    text = text.replace('π', 'pi').replace('−', '-').replace('–', '-')
    text = text.replace('·', '').replace('⋅', '').replace('\\sqrt', '√').replace('\\', '')
    return re.sub(r'\s+', '', text)


def verdict(text, place):
    t = norm(text)
    right = re.search(place['right'], t) is not None
    wrong = place['wrong'] is not None and re.search(place['wrong'], t) is not None
    if right and not wrong:
        return 'верно'
    if wrong and not right:
        return 'ИСПРАВИЛ'
    if right and wrong:
        return 'оба'
    return 'нет'


places = json.loads((HERE / 'places.json').read_text(encoding='utf-8'))['places']
reads = json.loads((HERE / 'out.json').read_text(encoding='utf-8')) if (HERE / 'out.json').exists() else {}
modes = ['R0', 'R1', 'R1t', 'R2']
rows, totals = [], {(k, m): 0 for k in ('problem', 'control') for m in modes}
for place in places:
    key = f"{place['run']}__{place['id']}"
    response = EVALS / place['run'] / place['id'] / 'response.json'
    texts = {'R0': json.loads(response.read_text(encoding='utf-8')).get('ocr') if response.exists() else ''}
    texts.update(reads.get(key, {}))
    marks = {m: verdict(texts.get(m, ''), place) if m in texts else '—' for m in modes}
    for m in modes:
        totals[(place['kind'], m)] += marks[m] == 'верно'
    rows.append(f"| {place['id']} | {place['kind']} | {place['what']} | " + ' | '.join(marks[m] for m in modes) + ' |')
problems = sum(p['kind'] == 'problem' for p in places)
controls = len(places) - problems
print('| Работа | Тип | Место | ' + ' | '.join(modes) + ' |')
print('| --- | --- | --- | ' + ' | '.join('---' for _ in modes) + ' |')
print('\n'.join(rows))
print()
for m in modes:
    print(f"{m}: спорные верно {totals[('problem', m)]}/{problems}, контрольные верно {totals[('control', m)]}/{controls}")
