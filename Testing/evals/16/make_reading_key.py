"""Build tasks/16/evals/reading-key.json (written by looking at each photo, 14.10.2026).

Patterns are written on the normalised text of score_reading.norm: no spaces, ∪ for union, ∞, ≥ ≤, log23 for log₂3.
iv() turns an interval template into a regex: ';' may also be ',', '+∞' may lose the plus.
"""
import json
import re
from pathlib import Path

OUT = Path(__file__).parent / "reading-key.json"


def iv(s):
    out = re.escape(s).replace(';', '[;,]').replace(r'\+∞', r'\+?∞')
    return out


def rx(cat, truth, right, wrong=None):
    d = {'cat': cat, 'truth': truth, 'check': 'regex', 'right': right}
    if wrong:
        d['wrong'] = wrong
    return d


def judge(cat, truth):
    return {'cat': cat, 'truth': truth, 'check': 'judge'}


def w(id_, set_, score, *places):
    return {'id': id_, 'set': set_, 'score': score, 'places': list(places)}


SQ = r'²'
works = [
    w('15.1.1', 'fipi', 2,
      rx('answer', 'Ответ: {−1} ∪ [1; √2) ∪ (√2; +∞)', iv('(-1)∪[1;√2)∪(√2;+∞)').replace(r'\(-1\)', r'[\(\{]-1[\)\}]')),
      rx('bounds', 'совокупность: 1 ≤ x < √2; x > √2; x = −1', iv('1≤x<√2'))),
    w('15.1.2', 'fipi', 2,
      rx('answer', 'Ответ: x ∈ {−1} ∪ [1; √2) ∪ (√2; +∞)', r'[\(\{]-1[\)\}]∪' + iv('[1;√2)∪(√2;+∞)')),
      rx('condition', '(x − 1)(x + 1)² ≥ 0', r'\(x-1\)\(x\+1\)' + SQ + '≥0')),
    w('15.1.3', 'fipi', 1,
      rx('condition', 'первая строка …+16 > 0 — строгий знак (ошибка ученика, в условии ≥)', r'16>0', r'16≥0'),
      rx('answer', 'Ответ: (1; √2) ∪ (√2; +∞) — без −1 и 1', iv('(1;√2)∪(√2;+∞)'), iv('[1;√2)')),
      judge('line', 'на прямой все четыре точки −√2, −1, 1, √2 выколоты (подписаны «гр»); знаки слева направо: −, −, −, +, +; штриховка правее 1')),
    w('15.1.4', 'fipi', 0,
      rx('condition', 'знаменатель (x − √2)(x + √2) без квадрата (ошибка ученика)', r'\(x-√2\)\(x\+√2\)≥0', r'\(x-√2\)' + SQ + r'\(x\+√2\)' + SQ + '≥0'),
      rx('answer', 'Ответ: (−√2; 1] ∪ (√2, +∞)', iv('(-√2;1]∪(√2;+∞)')),
      judge('line', 'точки −√2 (выколота), −1 (закрашена, с петлёй), 1 (закрашена), √2 (выколота); знаки слева направо: −, +, +, −, +')),
    w('15.2.1', 'fipi', 2,
      rx('answer', 'Ответ: x = 1; x ∈ (2; +∞)', iv('(2;+∞)')),
      rx('roots', '3^x = 3 ⇒ x = 1', r'x=1')),
    w('15.2.2', 'fipi', 2,
      rx('answer', 'Ответ: {1} ∪ (2; +∞)', r'[\(\{]1[\)\}]∪' + iv('(2;+∞)'))),
    w('15.2.3', 'fipi', 1,
      rx('answer', 'Ответ: x ∈ (2; +∞) — без x = 1 (ошибка ученика)', r'(Ответ|ответ):?x?∈?' + iv('(2;+∞)'), r'[\(\{]1[\)\}]∪\(2'),
      rx('bounds', '⇒ t > 9 (точка t = 3 потеряна)', r't>9'),
      judge('line', 'прямая по t: −9 и 0 отмечены, 3 закрашена, 9 выколота; знаки −, −, +; выделено правее 9')),
    w('15.2.4', 'fipi', 0,
      rx('answer', 'Ответ: x ∈ {1} ∪ (2; +∞)', r'[\(\{]1[\)\}]∪' + iv('(2;+∞)')),
      judge('line', 'в точке t = 3 петля со знаком «+» (ошибка ученика); знаки: −, −, +; −9 и 9 выколоты, 3 закрашена')),
    w('15.3.1', 'fipi', 2,
      rx('answer', 'Ответ: x ∈ (1; 31]', iv('(1;31]')),
      rx('bounds', 'x ∈ (−1; 1) ∪ (1; 31]', iv('(-1;1)∪(1;31]'))),
    w('15.3.2', 'fipi', 2,
      rx('answer', 'О: x ∈ (1; 31]', iv('(1;31]')),
      rx('condition', '(x − 1)(31 − x) ≥ 0', r'\(x-1\)\(31-x\)≥0')),
    w('15.3.3', 'fipi', 1,
      rx('answer', 'Ответ: x ∈ (1; 31) — 31 исключена (ошибка ученика)', iv('(1;31)'), iv('(1;31]')),
      rx('condition', '(x² − 32x + 31)/((x − 1)(x + 1)) ≤ 0', r'x' + SQ + r'-32x\+31\)?/\(?\(x-1\)\(x\+1\)\)?≤0')),
    w('15.3.4', 'fipi', 0,
      rx('odz', 'ОДЗ: система {x > 1; x < −1} (ошибка ученика)', r'x<-1'),
      rx('answer', 'Ответ: (1; 31]', iv('(1;31]'))),
    w('15.4.1', 'fipi', 2, rx('answer', 'Ответ: [1; 2) ∪ (3; +∞)', iv('[1;2)∪(3;+∞)'))),
    w('15.4.2', 'fipi', 2, rx('answer', 'Ответ: [1; 2) ∪ (3; +∞)', iv('[1;2)∪(3;+∞)'))),
    w('15.4.3', 'fipi', 2,
      rx('answer', 'Ответ: x ∈ [1; 2) ∪ (3; +∞)', iv('[1;2)∪(3;+∞)')),
      rx('bounds', '3 ≤ t < 9', r'3≤t<9')),
    w('15.4.4', 'fipi', 0,
      rx('condition', '3t − 9 ≥ 0 (знаменатель отброшен — ошибка ученика)', r'(^|[^/])3t-9≥0'),
      rx('answer', 'Ответ: x ∈ [1; 2) ∪ (2; 3) ∪ (3; +∞)', iv('[1;2)∪(2;3)∪(3;+∞)'))),
    w('15.5.1', 'fipi', 2,
      rx('answer', 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3]', iv('(-∞;0]∪(log23;2)∪(2;3]'))),
    w('15.5.2', 'fipi', 1,
      rx('answer', 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3) — 3 исключена (ошибка ученика)', iv('(log23;2)∪(2;3)'), iv('(2;3]'))),
    w('15.5.3', 'fipi', 0,
      rx('answer', 'Ответ: (−∞; 0] ∪ [2; 3] (2 включена — ошибка ученика)', iv('(-∞;0]∪[2;3]'), iv('(2;3]'))),
    w('15.6.1', 'fipi', 2,
      rx('answer', 'Ответ: [−3; 1)', iv('[-3;1)')),
      rx('condition', '(x + 3)(x − 1)/(x + 4) ≤ 0', r'\(x\+3\)\(x-1\)\)?/\(?x\+4\)?≤0')),
    w('15.6.2', 'fipi', 0,
      rx('odz', 'ОДЗ: x ∈ (−4; 1); (2; +∞) — неверно решена система (ошибка ученика)', iv('(-4;1);(2;+∞)').replace('[;,]', '[;,∪]', 2)),
      rx('answer', 'Ответ: [−3; 1)', iv('[-3;1)'))),
    # Kostyan, handwritten
    w('K-B-2', 'kostyan', 2,
      rx('answer', 'x ∈ [−1; 2]', iv('[-1;2]')),
      rx('condition', '3t² − 28t + 9 ≤ 0 (поверх зачёркнутого)', r'3t' + SQ + r'-28t\+9')),
    w('K-B-3', 'kostyan', 2,
      rx('answer', 'x ∈ [−1; 2]', iv('[-1;2]')),
      rx('condition', '(t − 1/3)(t − 9)/(t + 1)² ≤ 0', r'\(t-1/3\)\(t-9\)')),
    w('K-B-4', 'kostyan', 2,
      rx('answer', 'x ∈ [−1; 2] (вторая страница)', iv('[-1;2]')),
      rx('condition', '3t² − 28t + 9 ≤ 0', r'3t' + SQ + r'-28t\+9')),
    w('K-D-11', 'kostyan', 2,
      rx('answer', 'x ∈ (−5; −√22] ∪ [−4; 4] ∪ [√22; 5): −∞ и +∞ зачёркнуты, под ними −5 и 5', r'-5|5\)'),
      rx('condition', 'x² ≥ 22 (исправленная цифра)', r'x' + SQ + '≥22')),
    w('K-D-12', 'kostyan', 2,
      rx('answer', 'x ∈ (−5; −√22] ∪ [−4; 4] ∪ [√22; 5)', iv('[-4;4]')),
      rx('condition', 'x² ≥ 22', r'x' + SQ + '≥22')),
    w('K-D-13', 'kostyan', 2,
      rx('answer', 'x ∈ (−5; −√22] ∪ [−4; 4] ∪ [√22; 5)', iv('[-4;4]')),
      rx('condition', 'x² ≥ 22', r'x' + SQ + '≥22')),
    w('K-P16', 'kostyan', 2,
      rx('answer', 'Ответ: 0 (x = 0)', r'x=0'),
      rx('bounds', 't ∈ [(−7 − 3√5)/2; (−7 + 3√5)/2] ∪ {1}', r'∪[\(\{]1[\)\}]')),
    w('K-P17', 'kostyan', 2,
      rx('answer', 'Ответ: [2log₃2; log₃82)', r'\[2log32;log382\)'),
      rx('bounds', 't ∈ (−∞; −2] ∪ [4; 82)', iv('[4;82)'))),
    w('K-P18', 'kostyan', 2,
      rx('answer', 'Ответ: (−∞; −2) ∪ [−log₂√5; +∞)', iv('(-∞;-2)∪[-log2√5;+∞)')),
      rx('bounds', 't ∈ (0; √5] ∪ (4; +∞)', iv('(0;√5]∪(4;+∞)'))),
    w('K-P19', 'kostyan', 0,
      rx('answer', 'Ответ: (−∞; 2) ∪ (log₂6; 3] — x = 0 не исключён (ошибка ученика)', iv('(-∞;2)∪(log26;3]'), iv('(0;2)'))),
    w('K-P20', 'kostyan', 2,
      rx('answer', 'Ответ: (0; 1] ∪ (2; +∞)', iv('(0;1]∪(2;+∞)')),
      rx('bounds', '1 < t ≤ 3 или t > 9', r'1<t≤3')),
    w('K-P21', 'kostyan', 1,
      rx('answer', 'Ответ: (−∞; −7) ∪ (−1 − log₂5; +∞) — круглая скобка (ошибка ученика)', iv('∪(-1-log25;+∞)'), iv('∪[-1-log25')),
      rx('bounds', 'x ≥ −1 − log₂5', r'x≥-1-log25')),
    # Kostyan, typed (student-text.txt)
    w('K-I', 'kostyan', 2, rx('answer', 'Ответ: (0; 1) ∪ {4} ∪ (32; +∞)', r'\(0;1\)∪[\(\{]4[\)\}]∪' + iv('(32;+∞)'))),
    w('K-K', 'kostyan', 2, rx('answer', 'Ответ: (0; 1/√5] ∪ [√5; +∞)', iv('(0;1/√5]∪[√5;+∞)'))),
    w('K-L', 'kostyan', 2, rx('answer', 'Ответ: {−3}', r'[\(\{]-3[\)\}]')),
    w('K-X4', 'kostyan', 1,
      rx('condition', '(t − 2)²/(t(t − 5)) ≥ 0 ⇔ 1/(t(t − 5)) > 0 (деление на (t − 2)² — ошибка ученика)', r'1/\(t\(t-5\)\)>0'),
      rx('answer', 'Ответ: (0; 1) ∪ (32; +∞)', iv('(0;1)∪(32;+∞)'))),
    w('K-X5', 'kostyan', 0,
      rx('answer', 'Ответ: (−∞; −√22] ∪ [−4; 4] ∪ [√22; +∞)', iv('(-∞;-√22]∪[-4;4]∪[√22;+∞)'))),
    w('K-X6', 'kostyan', 1,
      rx('condition', '8(x + 1)² раскрыто как 8x² + 8x + 8 (ошибка ученика)', r'8x' + SQ + r'\+8x\+8'),
      rx('answer', 'Ответ: ∅', r'∅')),
]
BRACKET_WRONG = r'система:|begin\(cases\)|begincases|фигурн'
EXTRA = {
    '15.1.1': [rx('bracket', 'совокупность (квадратная скобка): 1 ≤ x < √2; x > √2; x = −1', 'совокупность', BRACKET_WRONG),
               rx('condition', 'рационализация: ((2 − 1)(x² − 2))² — множитель (2 − 1), не (2 − 2)', r'\(2-1\)\(x', r'\(2-2\)\(x')],
    '15.2.2': [rx('bracket', 'совокупность: t ≥ 9; t = 3', 'совокупность', BRACKET_WRONG),
               rx('bounds', 't ≥ 9 и t = 3 (не t ≤ 3)', r't=3', r't≤3')],
    'K-D-11': [rx('bracket', 'совокупность: t ≤ 1; t ≥ 2 и дальше', 'совокупность', BRACKET_WRONG)],
    'K-P17': [rx('bracket', 'совокупность: 3^x ≤ −2; система: 3^x ≥ 4, 3^x < 82 (вложенные)', 'совокупность'),
              rx('roots', '3^x ≤ −2 ⇒ x ∉ ℝ', r'x∉', r'x∈R|x∈ℝ|x∈mathbbR')],
    'K-P18': [rx('bracket', 'совокупность: 0 < 2^(−x) ≤ √5; 2^(−x) > 4', 'совокупность', BRACKET_WRONG)],
}
for x in works:
    x['places'] += EXTRA.get(x['id'], [])
key = {'task': 16, 'note': 'Ключ чтения задания 16: что на фото на самом деле в местах, от которых зависит балл. '
       'Только рабочие наборы (ФИПИ и Кастян); CHECK-MAT не использовать.', 'works': works}
OUT.write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding='utf-8')
places = [p for x in works for p in x['places']]
from collections import Counter
print(len(works), 'работ;', len(places), 'мест;', dict(Counter(p['cat'] for p in places)),
      'judge:', sum(p['check'] == 'judge' for p in places))
for x in works:
    for p in x['places']:
        if p['check'] == 'regex':
            re.compile(p['right'])
            if 'wrong' in p:
                re.compile(p['wrong'])
