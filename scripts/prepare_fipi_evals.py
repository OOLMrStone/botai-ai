#!/usr/bin/env python3
"""Cut graded example works out of a FIPI expert-guide PDF into an eval set.

Offline, no model calls. For every "Пример N.g.k" in the page range it saves:
problems/N.g.png - statement and reference answer (header of the first example of the group);
N.g.k/solution.png or solution-0i.png - the embedded scans of the student's work;
N.g.k/expected.json - expert score and comment (hidden from the model).

Example:
python scripts/prepare_fipi_evals.py matematika_mr_ege_2026.pdf --source-task 13 \
    --target-task 14 --pages 14-36 --out tasks/14/evals/fipi
"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import re

import fitz
from PIL import Image

MIN_IMAGE_PT = 60  # smaller embedded images are typeset symbols such as ℤ
MIN_STRIP_PT = (200, 20)  # wide low strips continue a scan (e.g. the answer line)
HEADER = re.compile(r'Пример\s+(\d+\.\d+\.\d+)')
SCORE = re.compile(r'Оценка эксперта:?\s*(\d)')


def blocks(page):
    return [(fitz.Rect(b[:4]), b[4]) for b in page.get_text('blocks')]


def scans(page):
    found = []
    for info in page.get_image_info(xrefs=True):
        rect = fitz.Rect(info['bbox'])
        large = rect.width >= MIN_IMAGE_PT and rect.height >= MIN_IMAGE_PT
        strip = rect.width >= MIN_STRIP_PT[0] and rect.height >= MIN_STRIP_PT[1]
        if info['xref'] and (large or strip):
            found.append((rect, info['xref']))
    return sorted(found, key=lambda item: item[0].y0)


def locate_examples(doc, first, last):
    """Return example ids with the positions of their header and comment."""
    marks = []
    for index in range(first - 1, last):
        for rect, text in blocks(doc[index]):
            header = HEADER.search(text)
            if header:
                marks.append(('start', header.group(1), index, rect))
            if 'Комментарий' in text:
                marks.append(('comment', None, index, rect))
    examples = []
    for i, (kind, case_id, index, rect) in enumerate(marks):
        if kind != 'start':
            continue
        end = next((m for m in marks[i + 1:] if m[0] == 'comment'), None)
        if end is None:
            raise ValueError(f'No comment after example {case_id}')
        examples.append({'id': case_id, 'page': index, 'header': rect, 'end_page': end[2], 'end': end[3]})
    return examples


def solution_scans(doc, example):
    result = []
    for index in range(example['page'], example['end_page'] + 1):
        for rect, xref in scans(doc[index]):
            if index == example['page'] and rect.y1 <= example['header'].y1:
                continue
            if index == example['end_page'] and rect.y0 >= example['end'].y0:
                continue
            result.append((index, xref))
    return result


def problem_clip(doc, example, first_scan_top):
    page = doc[example['page']]
    top = example['header'].y1 + 2
    bottom = max((rect.y1 for rect, _ in blocks(page) if top <= rect.y0 < first_scan_top), default=top)
    bottom = min(bottom + 6, first_scan_top - 1)
    if bottom - top >= 30:
        return pixmap_image(page.get_pixmap(dpi=150, clip=fitz.Rect(40, top, page.rect.width - 40, bottom)))
    return task_page_problem(doc, example['id'].rsplit('.', 1)[0])


def task_page_problem(doc, group):
    """Some examples print no statement: take it and the answer line from the "Задание N.g" page."""
    for page in doc:
        headers = page.search_for(f'Задание {group}')
        solution = page.search_for('Решение')
        if headers and solution and solution[0].y0 > headers[0].y1:
            statement = page.get_pixmap(dpi=150, clip=fitz.Rect(40, headers[0].y1 + 2, page.rect.width - 40, solution[0].y0 - 2))
            for answer_page in (page, doc[page.number + 1]):
                answers = answer_page.search_for('Ответ:')
                if answers:
                    line = answers[0]
                    answer = answer_page.get_pixmap(dpi=150, clip=fitz.Rect(40, line.y0 - 2, answer_page.rect.width - 40, line.y1 + 6))
                    return stack([pixmap_image(statement), pixmap_image(answer)])
    raise ValueError(f'No statement found for group {group}')


def pixmap_image(pixmap):
    return Image.open(io.BytesIO(pixmap.tobytes('png'))).convert('RGB')


def expert_result(doc, example):
    text = ''.join(doc[i].get_text() for i in range(example['end_page'], min(example['end_page'] + 2, len(doc))))
    start = text.find('Комментарий')
    score = SCORE.search(text, start)
    if start < 0 or score is None:
        raise ValueError(f'No expert score for {example["id"]}')
    comment = re.sub(r'\s+', ' ', text[start + len('Комментарий'):score.start()]).strip(' .\n')
    return int(score.group(1)), comment + '.'


def load_scan(doc, xref):
    return Image.open(io.BytesIO(doc.extract_image(xref)['image'])).convert('RGB')


def pages_of_scans(doc, found):
    """The service accepts at most four photos: above that, stack the scans of one PDF page."""
    if len(found) <= 4:
        return [[load_scan(doc, xref)] for _, xref in found]
    groups = {}
    for index, xref in found:
        groups.setdefault(index, []).append(load_scan(doc, xref))
    return list(groups.values())


def stack(images):
    if len(images) == 1:
        return images[0]
    canvas = Image.new('RGB', (max(i.width for i in images), sum(i.height for i in images)), 'white')
    y = 0
    for image in images:
        canvas.paste(image, (0, y))
        y += image.height
    return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--source-task', type=int, required=True)
    parser.add_argument('--target-task', type=int, required=True)
    parser.add_argument('--pages', required=True, help='first-last printed page of the example section')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--verdicts', type=Path,
                        help='JSON {case_id: verdict or {score, fipi_score, verdict}} replacing garbled comments')
    args = parser.parse_args()

    first, last = map(int, args.pages.split('-'))
    overrides = json.loads(args.verdicts.read_text(encoding='utf-8')) if args.verdicts else {}
    doc = fitz.open(args.pdf)
    cases, problems = [], set()
    for example in locate_examples(doc, first, last):
        case_id = example['id']
        group = case_id.rsplit('.', 1)[0]
        found = solution_scans(doc, example)
        photos = [stack(group) for group in pages_of_scans(doc, found)]
        if not 1 <= len(photos) <= 4:
            raise ValueError(f'{case_id}: expected 1-4 photos, found {len(photos)}')
        xrefs = [xref for _, xref in found]
        folder = args.out / case_id
        folder.mkdir(parents=True, exist_ok=True)
        names = ['solution.png'] if len(photos) == 1 else [f'solution-{i:02d}.png' for i in range(1, len(photos) + 1)]
        for photo, name in zip(photos, names):
            photo.save(folder / name)
        problem = f'problems/{group}.png'
        if group not in problems:
            (args.out / 'problems').mkdir(parents=True, exist_ok=True)
            first_scan = next(r for r, x in scans(doc[example['page']]) if x == xrefs[0]) \
                if any(x == xrefs[0] for _, x in scans(doc[example['page']])) else doc[example['page']].rect
            problem_clip(doc, example, first_scan.y0).save(args.out / problem)
            problems.add(group)
        score, comment = expert_result(doc, example)
        override = overrides.get(case_id, comment)
        if isinstance(override, dict):  # a documented decision that departs from the FIPI score
            expected = {'score': override['score'], 'fipi_score': override.get('fipi_score', score),
                        'verdict': override['verdict']}
        else:
            expected = {'score': score, 'verdict': override}
        (folder / 'expected.json').write_text(json.dumps(expected, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        cases.append({'id': case_id, 'source_page': example['page'] + 1, 'problem_and_reference_answer': problem,
                      'solution': f'{case_id}/{names[0]}' if len(names) == 1 else [f'{case_id}/{n}' for n in names],
                      'expected': f'{case_id}/expected.json'})
        print(case_id, 'p.', example['page'] + 1, 'photos', len(photos), 'score', score)
    manifest = {'source': args.pdf.name, 'source_task_number': args.source_task,
                'target_task_number': args.target_task, 'cases': cases}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
