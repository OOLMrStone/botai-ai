"""Score transcripts against the task-16 reading key.

Usage: python score_reading.py <transcripts.json>   where transcripts.json is {"<work id>": "<text>", ...}.
Regex places are checked on a normalised text; judge places (number lines) are listed for a separate
meaning check and are not counted here.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

KEY = json.loads((Path(__file__).parent / 'reading-key.json').read_text(encoding='utf-8'))
SUB = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')


def norm(text: str) -> str:
    text = (text or '').replace('\\pi', 'π')
    for _ in range(3):
        text = re.sub(r'\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}', r'\1/\2', text)
        text = re.sub(r'\\sqrt\{([^{}]*)\}', r'√\1', text)
    for a, b in (('\\infty', '∞'), ('\\notin', '∉'), ('\\in', '∈'), ('^{2}', '²'), ('^2', '²'), ('\\cup', '∪'), ('\\geqslant', '≥'), ('\\leqslant', '≤'), ('\\geq', '≥'),
                 ('\\leq', '≤'), ('\\ge', '≥'), ('\\le', '≤'), ('\\neq', '≠'), ('\\ne', '≠'), ('\\varnothing', '∅'),
                 ('\\emptyset', '∅'), ('\\sqrt', '√'), ('\\cdot', ''), ('\\left', ''), ('\\right', ''),
                 ('>=', '≥'), ('<=', '≤'), ('−', '-'), ('–', '-'), ('·', ''), ('⋅', ''), ('\\{', '{'), ('\\}', '}')):
        text = text.replace(a, b)
    text = text.translate(SUB)
    text = re.sub(r'(?<=[\)\]\}∞\d])\s*[Uu∪]\s*(?=[\(\[\{])', '∪', text)  # union written as U or u
    text = text.replace('\\', '').replace('$', '')
    text = re.sub(r'log_?\{?(\d+)\}?', r'log\1', text)
    return re.sub(r'\s+', '', text)


def verdict(text: str, place: dict) -> str:
    t = norm(text)
    right = re.search(place['right'], t) is not None
    wrong = 'wrong' in place and re.search(place['wrong'], t) is not None
    if right and not wrong:
        return 'верно'
    if wrong and not right:
        return 'исправил'
    if right and wrong:
        return 'оба'
    return 'нет'


def score(transcripts: dict) -> dict:
    rows, totals = [], Counter()
    for work in KEY['works']:
        if work['id'] not in transcripts:
            continue
        for place in work['places']:
            if place['check'] != 'regex':
                continue
            v = verdict(transcripts[work['id']], place)
            totals[(place['cat'], v)] += 1
            rows.append((work['id'], place['cat'], v, place['truth']))
    return {'rows': rows, 'totals': totals}


if __name__ == '__main__':
    data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    result = score(data)
    for row in result['rows']:
        if row[2] != 'верно':
            print(' | '.join(row))
    cats = sorted({c for c, _ in result['totals']})
    for cat in cats:
        n = sum(v for (c, _), v in result['totals'].items() if c == cat)
        ok = result['totals'][(cat, 'верно')]
        print(f'{cat}: {ok}/{n} верно, исправил {result["totals"][(cat, "исправил")]}, оба {result["totals"][(cat, "оба")]}')
    n = sum(result['totals'].values())
    print('всего:', sum(v for (c, k), v in result['totals'].items() if k == 'верно'), '/', n)
