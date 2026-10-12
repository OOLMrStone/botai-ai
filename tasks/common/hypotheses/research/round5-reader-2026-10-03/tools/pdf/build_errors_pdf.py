"""Build per-task PDFs with every model mismatch: photos, expert verdict, model answer, and what went wrong."""
import json
import shutil
from html import escape
from pathlib import Path

import fitz

ROOT = Path(r'C:\Users\kosti\Desktop\botai-ai\output\evals')
OUT = Path(r'C:\Users\kosti\Desktop')
WORK = Path(__file__).parent / 'err_build'

TASKS = {
    '14': {'title': 'Задание 14 — уравнения', 'file': 'Ошибки модели — 14 уравнения.pdf',
           'runs': ['v4-14', 'v4retry-14'], 'reshu': 'reshu-14'},
    '15': {'title': 'Задание 15 — стереометрия', 'file': 'Ошибки модели — 15 стереометрия.pdf',
           'runs': ['v4-15'], 'reshu': 'reshu-15'},
    '18': {'title': 'Задание 18 — планиметрия', 'file': 'Ошибки модели — 18 планиметрия.pdf',
           'runs': ['v4-18', 'v4retry-18'], 'reshu': 'reshu-18'},
}

# Kind: «чтение» — модель неверно прочитала фото; «логика» — прочитала верно, но неверно применила правила;
# «спорно» — причина вердикта эксперта не названа, нужен ответ эксперта.
WHY = {
    '13.2.3': ('чтение', 'У ученика <b>x₂ = −π</b> и в ответе <b>−13/14 π</b>. Модель прочитала <b>−3π</b> и <b>−13π/4</b> — '
               'как в правильном ответе. В расшифровке она сама пометила «возможно −π», но при анализе выбрала вариант, при котором решение сходится. '
               'Неверный отбор не замечен: 2 вместо 1.'),
    '13.3.2': ('чтение', 'В пункте б у ученика строка <b>π ≤ k ≤ 5π/2</b> — ошибка при делении на π. Модель прочитала <b>π ≤ πk ≤ 5π/2</b>, '
               'то есть сама дописала множитель, и строка стала верной. Ошибка в отборе не замечена: 2 вместо 1.'),
    '13.3.3': ('чтение', 'У ученика в ответе и у верхней точки окружности стоит <b>π/2</b> — корень вне отрезка [3π/2; 3π]. '
               'Модель прочитала <b>5π/2</b> («как должно быть»), посторонний корень не увидела: 2 вместо 1.'),
    '13.5.2': ('чтение', 'У ученика <b>2 5/6 &lt; 2k &lt; 4 1/3 | :2 → 1 5/6 &lt; k &lt; 2 1/3</b> — деление на 2 выполнено неверно. '
               'Модель записала <b>1 5/12 &lt; k &lt; 2 1/6</b>, то есть «досчитала» верно сама. ФИПИ за ошибку в отборе не засчитывает пункт б (1), '
               'модель засчитала: 2.'),
    '13.5.3': ('чтение', 'У ученика <b>cos x = −1 ⇒ x = π + πd</b> (неверный период), отсюда лишний корень 5π. Модель прочитала <b>π + 2πd</b> и '
               'выписала промежуточные строки, которых на фото нет, но которые следуют из верной серии. Заметила только лишний корень: 1 вместо 0.'),
    '13.6.3': ('чтение', 'У ученика ОДЗ <b>4 sin x ≠ 0</b> (нужно &gt; 0) и <b>8 = 4 sin x</b> из log₄(4 sin x) = 2 (нужно 16) — две невычислительные ошибки, '
               'любая даёт 0. Модель прочитала <b>&gt; 0</b> и <b>16</b> — обе ошибки исчезли: 2 вместо 0.'),
    '500366.2': ('чтение', 'У ученика «при k ≤ −8 …», «при k ≥ −6 …», «k = −7» зачёркнуто, в ответе один корень −13π/4. '
                 'Модель прочитала k = −8, −6, −4 и дописала в ответ недостающие корни: 2 вместо 1.'),
    '513092.1': ('чтение', 'Плотный лист в две колонки. В правой колонке ученик перешёл к неверному углу π/4 (ответ 9π/4; 11π/4) — '
                 'это не вычислительная ошибка. Модель прочитала правую колонку как повтор левой и сочла ошибку вычислительной: 1 вместо 0.'),
    '515919.1': ('логика', 'Прочитано верно. В пункте б у ученика только вычисления значений (π/6 + π = 7π/6; …) — без окружности, неравенств '
                 'и сравнения с концами отрезка, то есть отбор не обоснован (E11/E13). Модель отметила это лишь как «точку роста» и засчитала: 2 вместо 1.'),
    '515919.2': ('чтение', 'На окружности и в ответе у ученика <b>5π/6</b> (ошибка). Модель прочитала <b>7π/6</b> и сама объяснила выбор: '
                 '«можно спутать с 5π/6, но 5π/6 не принадлежит отрезку». Выбрала по правильности, а не по начертанию: 2 вместо 1.'),
    '14.1.4': ('спорно', 'У ученика «проведём из O <b>прямую</b> ⊥ SC», модель прочитала «плоскость ⊥ SC» и засчитала пункт а как «стандартный шаг». '
               'ФИПИ: «неверное доказательство пункта а», причина не названа; похожий шаг в 14.1.2 ФИПИ засчитал. Нужен ответ эксперта.'),
    '14.2.4': ('чтение', 'На чертеже ученика точка K лежит на <b>боковом ребре SB</b>, то есть решалась другая задача (ФИПИ: 0). '
               'Модель описала K «на ребре BC» — как в условии — и оценила решение как обычное: 1 вместо 0.'),
    '14.4.4': ('чтение', 'У ученика <b>4/15·√45 = 12√15/15 = 4√15/5</b> — неверно вынесен множитель, ответ неверный. Модель везде прочитала <b>√5</b> '
               '(в расшифровке было «√5 или √15», выбран √5 «по проверке»), ответ стал верным: 3 вместо 1.'),
    '14.5.1': ('чтение', 'Плотные тёмные снимки. Ключевая строка доказательства пункта а («BO ⊥ ZR ⇒ …») при чтении потеряна, '
               'пропуски заполнены в пользу ученика («читаемые величины согласуются с верным решением»): 3 вместо 1. В другом прогоне прочитано верно — 1.'),
    '14.5.3': ('чтение', '<b>Занижение.</b> Модель прочитала KD как KO и «трапеция ELKD» как «тр. ELK», отсюда решила, что прямые признака не лежат в '
               'плоскости γ, и не засчитала пункт а: 1 вместо 3. ФИПИ: «доказательство содержит неточности», 3. В другом прогоне прочитано верно — 3.'),
    '14.6.1': ('спорно', 'Прочитано верно: «(DKP) ⊥ (ADK), AK ⊥ DK ⇒ AK ⊥ (DPK)». ФИПИ не засчитал пункт а без объяснения причины '
               '(так же во всей серии 14.6), модель засчитала: 3 вместо 2. Нужен ответ эксперта.'),
    '14.6.2': ('логика', 'Ученик только заявил «PK — высота пирамиды». Модель сама дописала обоснование (прямая пересечения двух плоскостей, '
               'перпендикулярных третьей) и засчитала пункт а: 1 вместо 0. Дописывать обоснование за ученика нельзя.'),
    '14.6.3': ('логика', 'У ученика «PAB ⊥ ADK и PKD ⊥ ADK ⇒ ∠AKP = ∠DKP = 90°» — не указано, что PK — общая прямая этих плоскостей. '
               'Модель: «теорема не названа, но её условия выполнены», засчитала пункт а: 3 вместо 2.'),
    '513097.1': ('логика', 'Модель сама нашла, что в пункте б не обосновано, что высота к SB — искомое расстояние (E11), но выбрала строку '
                 '«верный ответ б с использованием утверждения а» (1). Если б не обоснован, эта строка не подходит: 0.'),
    '17.6.2': ('логика', '«AC ∥ NK ⇒ ACKN — трапеция» без проверки, что другая пара сторон не параллельна. По решению руководителя пункт а '
               'не засчитывается (E03), балл 0. Модель увидела E03, но отклонила («вывод AN = CK от этого не зависит»): 1 — как исходный балл ФИПИ.'),
}

CSS = """
* { font-family: sans-serif; }
body { font-size: 10pt; line-height: 1.35; }
h1 { font-size: 17pt; margin: 0 0 4pt 0; }
h2 { font-size: 13pt; margin: 6pt 0 4pt 0; }
.sub { color: #555; font-size: 9pt; }
.why { background-color: #fff1e6; border: 1px solid #f0b080; padding: 6pt; }
.kind { font-weight: bold; color: #b04000; }
.box { background-color: #f3f5f8; padding: 5pt; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #aaa; padding: 3pt; font-size: 9pt; vertical-align: top; }
th { background-color: #e6e6e6; text-align: left; }
"""


def results(run):
    out = {}
    for path in (ROOT / run).glob('*/result.json'):
        r = json.loads(path.read_text(encoding='utf-8'))
        out[r['id']] = (r, path.parent)
    return out


def text(value, limit):
    value = (value or '').strip()
    return escape(value[:limit] + ('…' if len(value) > limit else ''))


def case_html(case_id, result, folder, source):
    exp = json.loads((folder / 'expected.json').read_text(encoding='utf-8'))
    resp = json.loads((folder / 'response.json').read_text(encoding='utf-8'))
    kind, why = WHY.get(case_id, ('—', 'Разбор не подготовлен.'))
    imgs = []
    for k, img in enumerate(sorted(folder.glob('solution-image*.png'))):
        name = f'{folder.parent.name}_{case_id}_{k}.png'
        shutil.copyfile(img, WORK / name)
        imgs.append(name)
    task_name = f'{folder.parent.name}_{case_id}_task.png'
    shutil.copyfile(folder / 'task-image.png', WORK / task_name)
    errors = resp.get('analysis', {}).get('errors') or []
    err_rows = ''.join(f"<tr><td>{escape(e.get('code') or '—')}</td><td>{text(e.get('description'), 160)}</td></tr>" for e in errors) \
        or '<tr><td colspan="2">ошибок не названо</td></tr>'
    photos = ''.join(f'<img src="{n}" width="500"/><br/>' for n in imgs)
    score = resp.get('grading', {}).get('score')
    return f"""
<h2>{escape(case_id)} — эксперт {exp['score']}, модель {score}</h2>
<p class="sub">{escape(source)}</p>
<div class="why"><span class="kind">Тип: {kind}.</span> {why}</div>
<p><b>Условие</b></p><img src="{task_name}" width="420"/>
<p><b>Решение ученика</b></p>{photos}
<p><b>Вердикт эксперта ({exp['score']}):</b> {text(exp.get('verdict'), 600)}</p>
<p><b>Ответ модели ({score}):</b></p>
<div class="box">{text(resp.get('grading', {}).get('explanation'), 900)}</div>
<p><b>Ошибки, которые назвала модель</b></p>
<table><tr><th>Код</th><th>Описание</th></tr>{err_rows}</table>
"""


def render(parts, out):
    archive = fitz.Archive(str(WORK))
    a4 = fitz.paper_rect('a4')
    left, top, right, bottom = 40, 36, a4.width - 40, a4.height - 36
    writer = fitz.DocumentWriter(str(out))
    for part in parts:
        story = fitz.Story(html=part, user_css=CSS, archive=archive)
        more = True
        while more:
            device = writer.begin_page(a4)
            more, _ = story.place(fitz.Rect(left, top, right, bottom))
            story.draw(device)
            writer.end_page()
    writer.close()


for task, spec in TASKS.items():
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir()
    fipi = {}
    for run in spec['runs']:
        for cid, (r, folder) in results(run).items():
            if cid not in fipi or fipi[cid][0]['outcome'] != 'graded':
                fipi[cid] = (r, folder)
    reshu = results(spec['reshu'])
    misses = [(cid, r, f, 'ФИПИ-2026, методичка для экспертов') for cid, (r, f) in sorted(fipi.items())
              if r['outcome'] == 'graded' and not r['score_match']]
    misses += [(cid, r, f, 'Решу ЕГЭ, Школа экспертов (балл эксперта сайта, сверен с критериями ФИПИ)')
               for cid, (r, f) in sorted(reshu.items()) if r['outcome'] == 'graded' and not r['score_match']]
    f_match = sum(r['score_match'] for r, _ in fipi.values())
    f_graded = sum(r['outcome'] == 'graded' for r, _ in fipi.values())
    r_match = sum(r['score_match'] for r, _ in reshu.values())
    r_graded = sum(r['outcome'] == 'graded' for r, _ in reshu.values())
    kinds = {}
    for cid, *_ in misses:
        kinds[WHY.get(cid, ('—',))[0]] = kinds.get(WHY.get(cid, ('—',))[0], 0) + 1
    intro = f"""
<h1>Ошибки модели: {spec['title']}</h1>
<p class="sub">02.10.2026 · модель deepseek-v4-flash · итоговая версия промптов (v4, отдельный шаг расшифровки); техсбои повторены один раз</p>
<table>
<tr><th>Набор</th><th>Работ</th><th>Оценено</th><th>Совпало с экспертом</th></tr>
<tr><td>ФИПИ-2026</td><td>{len(fipi)}</td><td>{f_graded}</td><td>{f_match}</td></tr>
<tr><td>Решу ЕГЭ (независимый)</td><td>{len(reshu)}</td><td>{r_graded}</td><td>{r_match}</td></tr>
</table>
<p>Ниже — каждая работа, где балл модели разошёлся с экспертом ({len(misses)}): фото, вердикт эксперта, ответ модели и разбор.</p>
<p><b>Типы ошибок:</b> {', '.join(f'{k} — {v}' for k, v in kinds.items()) or 'нет'}.<br/>
<b>чтение</b> — модель неверно прочитала запись ученика (обычно «как должно быть» — стирая его ошибку);
<b>логика</b> — прочитала верно, но неверно применила правила оценки;
<b>спорно</b> — эксперт не назвал причину, нужен его ответ.</p>
"""
    parts = [intro] + [case_html(cid, r, f, src) for cid, r, f, src in misses]
    render(parts, OUT / spec['file'])
    print(task, 'misses', len(misses), 'pages', len(fitz.open(str(OUT / spec['file']))), [m[0] for m in misses])
