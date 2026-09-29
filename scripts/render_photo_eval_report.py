#!/usr/bin/env python3
"""Render an offline Russian eval report; no model or network requests."""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
from html import escape
import json
import mimetypes
from pathlib import Path


LABELS = {'graded': 'Оценено', 'rejected': 'Отказ', 'http_error': 'Ошибка HTTP',
          'transport_error': 'Сбой соединения', 'invalid_response': 'Неверный формат',
          'uncertain_no_retry': 'Результат неизвестен', 'not_started': 'Не запускалось'}
RATINGS = {'good': 'Хороший', 'medium': 'Средний', 'bad': 'Плохой', 'empty': 'Отсутствует'}


def read_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, UnicodeError):
        return default


def text(value):
    if value is None:
        return '—'
    return str(value)


def h(value):
    return escape(text(value), quote=True)


def paragraph(value):
    return '<p>' + h(value).replace('\n', '<br>') + '</p>'


def md(value):
    return text(value).replace('<', '&lt;').replace('>', '&gt;').replace('|', '\\|').replace('\n', '<br>')


def image_html(folder, prefix, title):
    candidates = sorted(p for p in folder.glob(prefix + '*') if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'))
    return image_files_html(candidates, title)


def image_files_html(candidates, title):
    if not candidates:
        return '<figure><figcaption>' + h(title) + ' — файл отсутствует</figcaption></figure>'
    figures = []
    for index, path in enumerate(candidates, 1):
        encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        mime = mimetypes.guess_type(path.name)[0] or 'image/png'
        caption = title if len(candidates) == 1 else f'{title} · фото {index} из {len(candidates)}'
        figures.append(f'<figure><figcaption>{h(caption)}</figcaption><a href="data:{mime};base64,{encoded}" target="_blank" rel="noopener"><img loading="lazy" src="data:{mime};base64,{encoded}" alt="{h(caption)}"></a></figure>')
    return '<div>' + ''.join(figures) + '</div>'


def student_images_html(folder):
    meta = read_json(folder / 'inputs.json', {})
    inputs = meta.get('provenance', {}).get('solution_inputs', [])
    typed = any(item.get('type') == 'literal_text_render' for item in inputs)
    title = 'Текст решения из источника' if typed else 'Фотографии решения ученика'
    content = image_html(folder, 'solution-image', title)
    if typed:
        return content + paragraph('В исходном наборе для этого случая есть только текст решения, фотографии нет. Здесь показан текст, перенесённый на изображение и отправленный модели.')
    originals = []
    dataset = Path(__file__).resolve().parents[1] / 'tasks/16/evals/kostyan'
    for item in inputs:
        name = item.get('original')
        if name and item.get('prepared_from') != name:
            path = (dataset / name).resolve()
            if path.is_relative_to(dataset.resolve()) and path.is_file() and path not in originals:
                originals.append(path)
    if originals:
        content += '<details><summary>Оригинальные фотографии целиком, до выделения задачи</summary>'
        content += image_files_html(originals, 'Исходное фото ученика без обрезки') + '</details>'
    return content


def load_run(directory):
    run = read_json(directory / 'run.json', {})
    summary = read_json(directory / 'summary.json', {})
    ids = [c['id'] for c in run.get('identity', {}).get('cases', [])]
    if not ids:
        ids = [c['id'] for c in summary.get('cases', [])]
    if not ids:
        ids = sorted(p.name for p in directory.iterdir() if p.is_dir() and (p / 'started.json').exists())
    rows = []
    for case_id in ids:
        folder = directory / case_id
        result = read_json(folder / 'result.json', {})
        expected = read_json(folder / 'expected.json', {})
        response = read_json(folder / 'response.json', {})
        if not isinstance(response, dict):
            response = {}
        outcome = result.get('outcome', 'uncertain_no_retry' if (folder / 'started.json').exists() else 'not_started')
        actual = result.get('actual_score')
        wanted = expected.get('score', result.get('expected_score'))
        expect_rejection = expected.get('expected_outcome') == 'rejected'
        matched = not expect_rejection and outcome == 'graded' and type(actual) is int and type(wanted) is int and actual == wanted
        correct_refusal = expect_rejection and outcome == 'rejected'
        wanted_display = 'Отказ' if expect_rejection else wanted
        actual_display = 'Отказ' if outcome == 'rejected' else actual
        rows.append({'id': case_id, 'folder': folder, 'result': result, 'expected': expected,
                     'response': response, 'outcome': outcome, 'actual': actual,
                     'wanted': wanted, 'matched': matched, 'expect_rejection': expect_rejection,
                     'correct_refusal': correct_refusal, 'passed': matched or correct_refusal,
                     'wanted_display': wanted_display, 'actual_display': actual_display})
    return run, rows


def render(directory, dataset_label="Base ИВЛС"):
    run, rows = load_run(directory)
    counts = Counter(row['outcome'] for row in rows)
    graded = counts['graded']
    matches = sum(row['matched'] for row in rows)
    mismatches = sum(row['outcome'] == 'graded' and not row['expect_rejection'] and not row['matched'] for row in rows)
    failures = sum(counts[k] for k in ('http_error', 'transport_error', 'invalid_response'))
    pending = sum(counts[k] for k in ('uncertain_no_retry', 'not_started'))
    advice_review = read_json(directory / 'advice-review.json', {})
    criterion_review = read_json(directory / 'criterion-review.json', {})
    advice_items = advice_review.get('items', [])
    criterion_items = criterion_review.get('items', [])
    config = read_json(directory / 'config.json', {})
    stamp = datetime.now(timezone.utc).isoformat()
    title = f'{dataset_label} · Проверка фотографий'
    corpus_note = (f'Один прогон на {len(rows)} известных примерах ФИПИ, использовавшихся при разработке правил. '
                   'Это не независимая оценка качества на новых работах.'
                   if dataset_label == 'Base ИВЛС' else
                   f'Отдельный набор: {len(rows)} работ. Результаты относятся только к этому прогону; '
                   'совпадение балла не доказывает правильность объяснения.')
    if dataset_label == 'Кастян ИВЛС':
        corpus_note = ('18 проверок математических решений представляют 14 математических сценариев: '
                       'часть работ снята в нескольких ракурсах. Дополнительно проверена одна отправка другого задания '
                       'с ожидаемым отказом. Фото условия содержат короткое полное эталонное решение — '
                       'это отличие от Base ИВЛС. Результаты относятся только к этому прогону; '
                       'совпадение балла не доказывает правильность объяснения.')
    stats = [('Всего работ', len(rows)), ('Оценено', graded), ('Совпали баллы', matches),
             ('Разошлись баллы', mismatches), ('Ошибки HTTP', counts['http_error']),
             ('Другие технические сбои', failures - counts['http_error']),
             ('Отказы', counts['rejected']), ('Нет завершённого результата', pending)]
    if any(row['expect_rejection'] for row in rows):
        stats += [('Сценарии ожидаемого отказа', sum(row['expect_rejection'] for row in rows)),
                  ('Корректные ожидаемые отказы', sum(row['correct_refusal'] for row in rows)),
                  ('Оценено вместо отказа', sum(row['expect_rejection'] and row['outcome'] == 'graded' for row in rows)),
                  ('Неожиданные отказы', sum(not row['expect_rejection'] and row['outcome'] == 'rejected' for row in rows))]
    expert_label = 'Эксперт' if dataset_label == 'Base ИВЛС' else 'Репетитор'
    html = ['<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            '<title>' + h(title) + '</title>', '''<style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#202b3a;background:#f4f6f9;line-height:1.55}body{max-width:1160px;margin:0 auto;padding:32px 20px}h1{font-size:30px;line-height:1.2}h2{margin-top:32px}h3{margin:18px 0 6px}p{margin:8px 0;overflow-wrap:anywhere}.muted,small{color:#5c697b}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.stat,.card,table{background:white;border:1px solid #dce2eb;border-radius:12px}.stat{padding:16px}.stat b{display:block;font-size:28px}.toolbar{display:flex;gap:8px;margin:20px 0}button{padding:9px 15px;background:white;border:1px solid #bcc6d5;border-radius:7px;cursor:pointer}button[aria-pressed=true]{background:#2447a8;color:white}table{border-collapse:collapse;width:100%;overflow:hidden}td,th{text-align:left;padding:10px 12px;border-bottom:1px solid #e3e7ee}th{font-weight:600;background:#eaf0f8}.tablewrap{overflow:auto}.card{padding:18px;margin:16px 0}summary{cursor:pointer;font-weight:650}.badge{font-size:13px;padding:3px 8px;border-radius:5px;background:#eaf0f8}.bad{background:#fff0de}.good{background:#e2f3e9}.photos{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:12px 0}figcaption{font-size:14px;font-weight:600;margin-bottom:8px}img{max-width:100%;height:auto;border:1px solid #dde3ec}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:14px;border-radius:6px;font:14px/1.6 ui-monospace,monospace}.error{border-left:3px solid #b7c7e6;padding-left:14px;margin:16px 0}a{color:#2447a8}hr{border:0;border-top:1px solid #e3e7ee;margin:20px 0}[hidden]{display:none!important}@media(max-width:650px){.photos{grid-template-columns:1fr}body{padding:20px 12px}h1{font-size:24px}}@media print{.toolbar{display:none}.card{break-inside:avoid}body{background:white}}
</style>''', '<h1>' + h(title) + '</h1>',
            paragraph('Ожидаемые баллы и экспертные комментарии сравниваются с ответами сервиса после проверки. Они не передавались модели.'),
            paragraph(corpus_note),
            '<p class="muted">Модель: ' + h(config.get('model')) + ' · Режим: ' + h(config.get('mode')) + ' · Сформировано: ' + h(stamp) + '</p>',
            '<div class="stats">' + ''.join(f'<div class="stat"><b>{n}</b>{h(label)}</div>' for label, n in stats) + '</div>']
    markdown = [f'# {md(title)}', '', f'Модель: {md(config.get("model"))}. Режим: {md(config.get("mode"))}.', '',
                'Ожидаемые результаты не передавались модели. Совпадение балла не доказывает правильность разбора.', '',
                corpus_note, '',
                *[f'- {label}: {n}' for label, n in stats], '']
    if advice_items:
        ratings = Counter(item.get('rating') for item in advice_items)
        reviewed = advice_review.get('reviewed_case_ids', [])
        review_summary = f'Рецензия советов: {len(advice_items)} записей; работ в списке рецензии: {len(set(reviewed))}. '
        review_summary += '; '.join(f'{RATINGS[key]}: {ratings[key]}' for key in RATINGS)
        html += ['<h2>Качество советов</h2>', paragraph(review_summary)]
        markdown += ['## Качество советов', '', review_summary, '']
        absent = Counter(item.get('status') for item in advice_review.get('cases_without_advice', []))
        absence_summary = (f"Без советов: в {absent['not_needed']} работах совет не требовался; "
                           f"в {absent['missed_error']} работах модель пропустила ошибку. "
                           'Оценки полезности советов — мнение отдельного рецензента.')
        html.append(paragraph(absence_summary))
        markdown += [absence_summary, '']
    if criterion_items:
        by_id = {row['id']: row for row in rows}
        categories = Counter(item.get('category') for item in criterion_items
                             if not by_id.get(item.get('case_id'), {}).get('expect_rejection', False))
        reviewed_refusals = sum(item.get('category') == 'consistent'
                               and by_id.get(item.get('case_id'), {}).get('correct_refusal', False)
                               for item in criterion_items)
        criterion_summary = (f"По отдельной рецензии: {categories['consistent']} работ — балл и основная причина согласованы с экспертом; "
                             f"{categories['score_mismatch']} — расхождение балла; "
                             f"{categories['reason_mismatch']} — балл совпал, но объяснение первопричины неточно.")
        if reviewed_refusals:
            criterion_summary += f' Отдельно: {reviewed_refusals} корректный ожидаемый отказ без оценки.'
        html += ['<h2>Основания оценок</h2>', paragraph(criterion_summary)]
        markdown += ['## Основания оценок', '', criterion_summary, '']
    html += ['<h2>Сравнение результатов</h2><p class="muted">Совпадение балла само по себе не доказывает правильность распознавания, объяснения или советов.</p>',
             '<div class="toolbar"><button aria-pressed="true" data-filter="all">Все работы</button><button aria-pressed="false" data-filter="issues">Расхождения и сбои</button></div>',
             '<div class="tablewrap"><table><thead><tr><th>Работа</th><th>' + h(expert_label) + '</th><th>Модель</th><th>Результат</th><th>Время, с</th></tr></thead><tbody>']
    markdown += ['## Сравнение результатов', '', f'| Работа | {expert_label} | Модель | Результат | Время, с |', '|---|---:|---:|---|---:|']
    for row in rows:
        label = ('Баллы совпали' if row['matched'] else 'Баллы расходятся') if row['outcome'] == 'graded' else LABELS.get(row['outcome'], row['outcome'])
        if row['expect_rejection']:
            label = 'Ожидаемый отказ подтверждён' if row['correct_refusal'] else ('Выставлен балл вместо отказа' if row['outcome'] == 'graded' else label)
        row['label'] = label
        html.append(f'<tr data-matched="{str(row["passed"]).lower()}"><td><a href="#{h(row["id"])}">{h(row["id"])}</a></td><td>{h(row["wanted_display"])}</td><td>{h(row["actual_display"])}</td><td>{h(label)}</td><td>{h(row["result"].get("elapsed_seconds"))}</td></tr>')
        markdown.append(f'| {md(row["id"])} | {md(row["wanted_display"])} | {md(row["actual_display"])} | {md(label)} | {md(row["result"].get("elapsed_seconds"))} |')
    html += ['</tbody></table></div><h2>Работы и разбор</h2>']
    markdown += ['', '## Работы и разбор', '']
    for row in sorted(rows, key=lambda r: r['passed']):
        case_id = row['id']
        response = row['response']
        analysis = response.get('analysis') or {}
        grading = response.get('grading') or {}
        result = row['result']
        heading = f'{case_id} · {expert_label.lower()} {text(row["wanted_display"])} / модель {text(row["actual_display"])} · {row["label"]}'
        html += [f'<details class="card" id="{h(case_id)}" data-matched="{str(row["passed"]).lower()}" {"" if row["passed"] else "open"}><summary>{h(heading)}</summary>',
                 '<p class="muted">HTTP ' + h(result.get('status_code')) + ' · ID запроса: ' + h(result.get('request_id')) + '</p>',
                 '<div class="photos">', image_html(row['folder'], 'task-image', 'Условие и эталон'),
                 student_images_html(row['folder']), '</div>',
                 '<h3>Комментарий: ' + h(expert_label) + '</h3>', paragraph(row['expected'].get('verdict')),
                 '<h3>Объяснение модели</h3>', paragraph(grading.get('criterion')), paragraph(grading.get('explanation'))]
        markdown += [f'### {md(heading)}', '', f'{expert_label}: {md(row["expected"].get("verdict"))}', '',
                     f'Критерий модели: {md(grading.get("criterion"))}', '', f'Объяснение: {md(grading.get("explanation"))}', '']
        if row['expect_rejection']:
            note = f'Негативный сценарий: ожидается отказ без оценки. Исторический балл источника: {text(row["wanted"])}; в сравнение баллов он не входит.'
            html += [paragraph(note)]
            markdown += [note, '']
        input_meta = read_json(row['folder'] / 'inputs.json', {})
        provenance = {key: input_meta[key] for key in ('source', 'provenance', 'variant', 'case_type') if key in input_meta}
        if provenance:
            html += ['<details><summary>Источник и вариант</summary><pre>' + h(json.dumps(provenance, ensure_ascii=False, indent=2)) + '</pre></details>']
            markdown += ['Источник и вариант: ' + md(json.dumps(provenance, ensure_ascii=False)), '']
        for review in [i for i in criterion_items if i.get('case_id') == case_id]:
            html += ['<h3>Рецензия оценки</h3>', paragraph(review.get('category')), paragraph(review.get('reason')), paragraph(review.get('conclusion'))]
            markdown += ['Рецензия оценки: ' + md(review.get('category')), '', md(review.get('reason')), '', md(review.get('conclusion')), '']
        if row['outcome'] != 'graded':
            raw = (row['folder'] / 'response.txt').read_text(errors='replace') if (row['folder'] / 'response.txt').exists() else result.get('transport_error_type', row['label'])
            html += ['<h3>Отказ или технический результат</h3>', paragraph(response.get('rejection_reason') or row['label']), '<pre>' + h(raw) + '</pre>']
            markdown += ['Отказ / сбой: ' + md(response.get('rejection_reason') or row['label']), '', md(raw), '']
        html += ['<h3>Разбор модели</h3>', paragraph(analysis.get('summary')),
                 '<details><summary>Распознанные записи</summary><pre>' + h(response.get('ocr')) + '</pre></details>']
        markdown += ['Разбор: ' + md(analysis.get('summary')), '', '<details><summary>OCR</summary>', '', md(response.get('ocr')), '', '</details>', '']
        for error in analysis.get('errors', []):
            html += ['<div class="error"><h3>' + h(error.get('id')) + ' · ' + h(error.get('code')) + ' · ' + h(error.get('description')) + '</h3>',
                     '<b>Запись ученика</b>', paragraph(error.get('where')), '<b>Исправление</b>', paragraph(error.get('correct_version')),
                     '<b>Совет</b>', paragraph(error.get('advice') or 'Совет отсутствует')]
            markdown += [f'**{md(error.get("id"))} · {md(error.get("code"))} · {md(error.get("description"))}**', '',
                         'Запись: ' + md(error.get('where')), '', 'Исправление: ' + md(error.get('correct_version')), '',
                         'Совет: ' + md(error.get('advice') or 'Совет отсутствует'), '']
            for review in [i for i in advice_items if i.get('case_id') == case_id and i.get('error_id') == error.get('id')]:
                content = RATINGS.get(review.get('rating'), text(review.get('rating'))) + '. ' + text(review.get('reason'))
                html += ['<b>Рецензия совета</b>', paragraph(content), paragraph(review.get('improvement'))]
                markdown += ['Рецензия совета: ' + md(content), '', 'Предлагаемое улучшение: ' + md(review.get('improvement')), '']
            html += ['</div>']
        if not analysis.get('errors') and row['outcome'] == 'graded':
            html += [paragraph('Модель не перечислила ошибок; советов внутри ошибок нет.')]
        html += ['</details>']
    html += ['''<script>
document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
  const card=document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
  if(!card)return;
  event.preventDefault();
  card.hidden=false;card.open=true;
  card.scrollIntoView({block:'start'});
  const heading=card.querySelector('summary');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
}));
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const issues=button.dataset.filter==='issues';document.querySelectorAll('[data-matched]').forEach(node=>node.hidden=issues&&node.dataset.matched==='true');document.querySelectorAll('[data-filter]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));}));
</script></html>''']
    (directory / 'report.html').write_text('\n'.join(html), encoding='utf-8')
    (directory / 'REPORT.md').write_text('\n'.join(markdown), encoding='utf-8')
    print(json.dumps({'report': str(directory / 'report.html'), 'counts': dict(stats)}, ensure_ascii=False))
    return '\n'.join(html)


def render_site(base_directory, peer_directory):
    """Embed both independent reports; the existing URL remains portable as one file."""
    if base_directory == peer_directory:
        raise ValueError('Base and peer reports must use different run directories')
    base_html = render(base_directory, 'Base ИВЛС')
    (base_directory / 'report-base.html').write_text(base_html, encoding='utf-8')
    if peer_directory.exists() and (peer_directory / 'run.json').exists():
        peer_html = render(peer_directory, 'Кастян ИВЛС')
    else:
        peer_html = ('<!doctype html><html lang="ru"><meta charset="utf-8">'
                     '<style>body{font-family:system-ui,sans-serif;max-width:1160px;'
                     'margin:0 auto;padding:32px 20px;color:#202b3a;background:#f4f6f9}</style>'
                     '<h1>Кастян ИВЛС</h1><p>Новый набор готовится. '
                     'Здесь появятся результаты отдельного прогона задания 15.</p></html>')
    (base_directory / 'report-kostyan.html').write_text(peer_html, encoding='utf-8')
    wrapper = '''<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Проверка решений · Наборы</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif;color:#202b3a;background:#f4f6f9}body{display:flex;flex-direction:column;height:100dvh}header{flex:none;padding:16px 20px;background:white;border-bottom:1px solid #dce2eb}nav{max-width:1160px;margin:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.label{font-size:14px;color:#5c697b;margin-right:8px}button{font:inherit;font-weight:600;padding:9px 16px;border:1px solid #bcc6d5;background:white;color:#263958;border-radius:8px;cursor:pointer}button[aria-selected=true]{background:#2447a8;color:white;border-color:#2447a8}button:focus-visible{outline:3px solid #91b9ff;outline-offset:2px}iframe{display:block;width:100%;flex:1;border:0;min-height:0}textarea{display:none}noscript{padding:20px}
</style><header><nav role="tablist" aria-label="Набор проверочных работ"><span class="label">Набор работ</span>
<button id="base-tab" role="tab" aria-selected="true" aria-controls="report-frame" data-dataset="base">Base ИВЛС</button>
<button id="kostyan-tab" role="tab" aria-selected="false" aria-controls="report-frame" data-dataset="kostyan">Кастян ИВЛС</button>
</nav></header><iframe id="report-frame" title="Base ИВЛС" role="tabpanel" aria-labelledby="base-tab"></iframe>
<noscript>Для переключения встроенных отчётов включите JavaScript. Отдельные файлы: report-base.html и report-kostyan.html.</noscript>
'''
    wrapper += '<textarea id="base-content" aria-hidden="true">' + h(base_html) + '</textarea>'
    wrapper += '<textarea id="kostyan-content" aria-hidden="true">' + h(peer_html) + '</textarea>'
    wrapper += '''<script>
const frame=document.getElementById('report-frame');
function selectDataset(button){
  document.querySelectorAll('[data-dataset]').forEach(item=>item.setAttribute('aria-selected',String(item===button)));
  frame.title=button.textContent;frame.setAttribute('aria-labelledby',button.id);
  frame.srcdoc=document.getElementById(button.dataset.dataset+'-content').value;
}
document.querySelectorAll('[data-dataset]').forEach(button=>button.addEventListener('click',()=>selectDataset(button)));
selectDataset(document.getElementById('base-tab'));
</script></html>'''
    (base_directory / 'report.html').write_text(wrapper, encoding='utf-8')
    print(json.dumps({'site': str(base_directory / 'report.html'),
                      'default_dataset': 'Base ИВЛС', 'peer': str(peer_directory)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_directory', type=Path)
    parser.add_argument('--dataset-label', default='Base ИВЛС')
    parser.add_argument('--peer-report', type=Path, help='Run directory for the Кастян ИВЛС tab')
    arguments = parser.parse_args()
    directory = arguments.run_directory.resolve()
    if arguments.peer_report:
        render_site(directory, arguments.peer_report.resolve())
    else:
        render(directory, arguments.dataset_label)
