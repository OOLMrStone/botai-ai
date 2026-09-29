#!/usr/bin/env python3
"""Normalize the supplied corpus; preserve original student text and photographs."""
import hashlib
import json
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tasks/16/evals/kostyan'
SLUG = {'Б': 'B', 'Д': 'D', 'И': 'I', 'К': 'K', 'Л': 'L'}
FONT = '/System/Library/Fonts/Menlo.ttc'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def render(text, path):
    """Deterministic text rasterization; no generative change to student content."""
    font = ImageFont.truetype(FONT, 28)
    width, padding, step = 1500, 60, 42
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    lines = []
    for original in text.splitlines():
        line = original
        while measure.textlength(line, font=font) > width - 2 * padding:
            cut = len(line)
            while measure.textlength(line[:cut], font=font) > width - 2 * padding:
                cut -= 1
            space = line.rfind(' ', 0, cut)
            if space > cut // 2:
                cut = space
            lines.append(line[:cut])
            line = line[cut:]
        lines.append(line)
    height = max(300, padding * 2 + step * len(lines))
    assert height <= 8192 and width * height < 20_000_000
    image = Image.new('RGB', (width, height), 'white')
    drawing = ImageDraw.Draw(image)
    for n, line in enumerate(lines):
        drawing.text((padding, padding + n * step), line, font=font, fill='black')
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def main():
    source = json.loads((DATA / 'source-rows.json').read_text())
    references = json.loads((DATA / 'math-reference.json').read_text())
    refs = {r['reference_id']: r for r in references['references']}
    aliases = references['aliases']
    for key, ref in refs.items():
        stem = SLUG.get(key, key)
        folder = DATA / 'problems' / stem
        folder.mkdir(parents=True, exist_ok=True)
        payload = {k: ref[k] for k in ('statement', 'reference_answer', 'reference_solution')}
        save(folder / 'reference.json', {**payload, 'author': ref['reference_author'],
                                        'statement_source': ref['statement_source']})
        text = payload['statement'] + '\n\nПравильный ответ: ' + payload['reference_answer']
        text += '\n\nЭталонное решение:\n' + payload['reference_solution']
        (folder / 'task.txt').write_text(text)
        render(text, folder / 'task.png')
    cases = []
    for entry in source['items']:
        source_id = entry['case_id']
        stem = SLUG.get(source_id, source_id)
        ref_id = aliases.get(source_id, source_id)
        ref_stem = SLUG.get(ref_id, ref_id)
        groups = entry['photo_groups'] or [[]]
        for group in groups:
            variant = group[0].split('.')[0] if len(groups) > 1 else None
            case_id = 'K-' + stem + ('-' + variant if variant else '')
            folder = DATA / 'cases' / case_id
            folder.mkdir(parents=True, exist_ok=True)
            solutions = []
            provenance = []
            if group:
                for n, filename in enumerate(group, 1):
                    chosen = DATA / 'raw' / filename
                    if filename in ('16.2.jpg', '19.2.jpg'):
                        part = 'first' if source_id in ('P16', 'P19') else 'second'
                        chosen = DATA / 'assets/crops' / (Path(filename).stem + '-' + part + '.jpg')
                    destination = folder / f'solution-{n:02}{chosen.suffix}'
                    shutil.copyfile(chosen, destination)
                    solutions.append(str(destination.relative_to(DATA)))
                    provenance.append({'original': 'raw/' + filename,
                                       'prepared_from': str(chosen.relative_to(DATA)),
                                       'sha256': hashlib.sha256(chosen.read_bytes()).hexdigest()})
            else:
                text = entry['student_text']
                assert text.strip(), case_id
                (folder / 'student-text.txt').write_text(text)
                destination = folder / 'solution-01.png'
                render(text, destination)
                solutions.append(str(destination.relative_to(DATA)))
                provenance.append({'type': 'literal_text_render', 'source': entry['text_source'],
                                   'text_sha256': hashlib.sha256(text.encode()).hexdigest()})
            expected = {'score': entry['expected_score'], 'expected_outcome': entry['expected_outcome'],
                        'case_type': entry['casekind'], 'source_case_id': source_id,
                        'source': {'workbook': 'raw/Тесты бота-проверяющего.xlsx',
                                   'sheet': entry['source_sheet'], 'cells': entry['source_cells']},
                        'verdict': entry['description']}
            if entry['casekind'] == 'negative':
                expected['verdict'] += ' В исходном наборе ожидался 0; текущий контракт требует отказа без оценки.'
            save(folder / 'expected.json', expected)
            save(folder / 'provenance.json', {'source_case_id': source_id, 'photo_variant': variant,
                                             'solution_inputs': provenance, 'reference_id': ref_id,
                                             'reference_author': refs[ref_id]['reference_author']})
            cases.append({'id': case_id, 'source_case_id': source_id, 'source_task_number': 15,
                          'case_type': entry['casekind'],
                          'problem_and_reference_answer': f'problems/{ref_stem}/task.png',
                          'solution': solutions, 'expected': f'cases/{case_id}/expected.json',
                          'provenance': f'cases/{case_id}/provenance.json'})
    assert len(cases) == 19 and len({c['source_case_id'] for c in cases}) == 15
    save(DATA / 'manifest.json', {'name': 'kostyan_evals',
                                 'source': 'https://disk.360.yandex.ru/d/mN-r2pZegKg2eA',
                                 'source_task_number': 15, 'target_task_number': 16,
                                 'source_scenarios': 15, 'cases': cases})
    print(f'Prepared {len(cases)} cases, {len(refs)} task/reference images; no model calls')


if __name__ == '__main__':
    main()
