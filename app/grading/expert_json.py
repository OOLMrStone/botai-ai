"""Structured solution for the expert screen: steps from the reader, statuses from the analysis.

Minimal format agreed with Vasya (tasks/common/hypotheses/expert-json-decisions.md):
  ocr      = {"steps": [step, ...], "answer": str | None}
  step     = {"id": "s1", "type": "<one of TASK_STEP_TYPES[task]>", "title": str, "lines": [str, ...], "figure": figure | None}
  figure   = number line {"kind": "number_line", "variable": str, "note": str | None, "points": [...], "arcs": [...]}
             or unit circle {"kind": "unit_circle", "points": [...], "arcs": [...]}
  point    = {"id": "p1", "value": str, "included": bool, "sign": "+" | "-" | "0" | None, "bound": true (optional)}
             a bound is the edge of the domain drawn dashed ("при t > 0"); its "included" may be null
  arc      = {"from": point id | "-inf", "to": point id | "+inf", "sign": "+" | "-" | "0" | None, "selected": bool}
             a loop over one point is an arc with "from" == "to"
  statuses = [{"id": "s1", "status": "<one of STATUSES>", "note": str | None, "correct": str (optional)}, ...]
             one remark per step; "correct" (the record as it should be) only for error and consequence steps
  error    = analysis.errors[] item + {"step_id": step id | None, "penalty": int}: the step it is shown in
             and the points taken off for it (0 for a consequence or a repeat); penalties sum to at most max - score

Points of a number line go left to right in the order the student drew them, not to scale.
The reader writes ocr; the analysis writes statuses; the server checks each stage and that the final
response carries the reader's ocr unchanged. Usage: python -m app.grading.expert_json <stage> <file> [--ocr reader.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

# What the expert marks in each task (FIPI criteria): the step types of one task, never a common list.
TYPE_NAMES = {
    'condition': 'запись условия',
    'odz': 'ОДЗ',
    'substitution': 'замена',
    'transform': 'преобразование',
    'solve': 'решение простейшего уравнения или неравенства',
    'intervals': 'метод интервалов',
    'back_substitution': 'обратная замена',
    'selection': 'отбор: корни на отрезке, учёт ОДЗ',
    'construction': 'рисунок, построение, график',
    'proof': 'доказательство',
    'computation': 'вычисление',
    'model': 'модель: сведение задачи к уравнению, неравенству или системе',
    'critical': 'критические значения параметра',
    'cases': 'исследование случаев, число решений',
    'example': 'пример',
    'estimate': 'оценка',
    'answer': 'ответ',
    'other': 'другое',
}
TASK_STEP_TYPES = {
    14: ('condition', 'odz', 'substitution', 'transform', 'solve', 'back_substitution', 'selection', 'answer',
         'other'),
    15: ('condition', 'construction', 'proof', 'computation', 'answer', 'other'),
    16: ('condition', 'odz', 'substitution', 'transform', 'solve', 'intervals', 'back_substitution', 'selection',
         'answer', 'other'),
    17: ('condition', 'model', 'transform', 'computation', 'solve', 'answer', 'other'),
    18: ('condition', 'construction', 'proof', 'computation', 'answer', 'other'),
    19: ('condition', 'odz', 'substitution', 'transform', 'model', 'construction', 'critical', 'cases', 'answer',
         'other'),
    20: ('condition', 'example', 'proof', 'estimate', 'computation', 'answer', 'other'),
}
STEP_TYPES = tuple(TYPE_NAMES)
STATUSES = ('ok', 'error', 'consequence', 'minor')
SIGNS = ('+', '-', '0')
ENDS = ('-inf', '+inf')


def _is_text(value, *, empty=False):
    return type(value) is str and (empty or bool(value.strip()))


def _figure_errors(figure, path):
    if type(figure) is not dict:
        return [f'{path}: expected an object or null']
    errors = []
    kind = figure.get('kind')
    if kind not in ('number_line', 'unit_circle'):
        return [f'{path}.kind: expected "number_line" or "unit_circle"']
    allowed = {'kind', 'points', 'arcs'} | ({'variable', 'note'} if kind == 'number_line' else set())
    errors += [f'{path}.{key}: unexpected field' for key in figure if key not in allowed]
    if kind == 'number_line':
        if not _is_text(figure.get('variable')):
            errors.append(f'{path}.variable: expected a non-empty string')
        if figure.get('note') is not None and not _is_text(figure.get('note')):
            errors.append(f'{path}.note: expected a string or null')
    points = figure.get('points')
    ids = set()
    if type(points) is not list:
        errors.append(f'{path}.points: expected a list')
        points = []
    for i, point in enumerate(points):
        where = f'{path}.points[{i}]'
        if type(point) is not dict:
            errors.append(f'{where}: expected an object')
            continue
        errors += [f'{where}.{key}: unexpected field' for key in point
                   if key not in ('id', 'value', 'included', 'sign', 'bound')]
        if not _is_text(point.get('id')) or point.get('id') in ENDS:
            errors.append(f'{where}.id: expected a non-empty string other than -inf/+inf')
        elif point['id'] in ids:
            errors.append(f'{where}.id: duplicate "{point["id"]}"')
        else:
            ids.add(point['id'])
        if not _is_text(point.get('value')):
            errors.append(f'{where}.value: expected a non-empty string')
        bound = point.get('bound', False)
        if type(bound) is not bool:
            errors.append(f'{where}.bound: expected true or false')
        if type(point.get('included')) is not bool and not (bound is True and point.get('included') is None):
            errors.append(f'{where}.included: expected true or false')
        if point.get('sign') is not None and point.get('sign') not in SIGNS:
            errors.append(f'{where}.sign: expected "+", "-", "0" or null')
    arcs = figure.get('arcs')
    if type(arcs) is not list:
        errors.append(f'{path}.arcs: expected a list')
        arcs = []
    ends = ids | (set(ENDS) if kind == 'number_line' else set())
    for i, arc in enumerate(arcs):
        where = f'{path}.arcs[{i}]'
        if type(arc) is not dict:
            errors.append(f'{where}: expected an object')
            continue
        errors += [f'{where}.{key}: unexpected field' for key in arc if key not in ('from', 'to', 'sign', 'selected')]
        for end in ('from', 'to'):
            if arc.get(end) not in ends:
                errors.append(f'{where}.{end}: expected a point id' + (' or -inf/+inf' if kind == 'number_line' else ''))
        if arc.get('sign') is not None and arc.get('sign') not in SIGNS:
            errors.append(f'{where}.sign: expected "+", "-", "0" or null')
        if type(arc.get('selected')) is not bool:
            errors.append(f'{where}.selected: expected true or false')
    return errors


def ocr_errors(ocr, task_number=None) -> list[str]:
    """Problems of the reader's structured transcript; [] when it is valid. Step types are the task's own."""
    types = TASK_STEP_TYPES.get(task_number, STEP_TYPES)
    if type(ocr) is not dict:
        return ['$.ocr: expected an object']
    errors = [f'$.ocr.{key}: unexpected field' for key in ocr if key not in ('steps', 'answer')]
    if ocr.get('answer') is not None and not _is_text(ocr.get('answer')):
        errors.append('$.ocr.answer: expected a string or null')
    steps = ocr.get('steps')
    if type(steps) is not list or not steps:
        return errors + ['$.ocr.steps: expected a non-empty list']
    ids = set()
    for i, step in enumerate(steps):
        where = f'$.ocr.steps[{i}]'
        if type(step) is not dict:
            errors.append(f'{where}: expected an object')
            continue
        errors += [f'{where}.{key}: unexpected field' for key in step
                   if key not in ('id', 'type', 'title', 'lines', 'figure')]
        if not _is_text(step.get('id')):
            errors.append(f'{where}.id: expected a non-empty string')
        elif step['id'] in ids:
            errors.append(f'{where}.id: duplicate "{step["id"]}"')
        else:
            ids.add(step['id'])
        if step.get('type') not in types:
            errors.append(f'{where}.type: expected one of {", ".join(types)}')
        if not _is_text(step.get('title')):
            errors.append(f'{where}.title: expected a non-empty string')
        lines = step.get('lines')
        if type(lines) is not list or not all(_is_text(line, empty=True) for line in lines):
            errors.append(f'{where}.lines: expected a list of strings')
        if step.get('figure') is not None:
            errors += _figure_errors(step['figure'], f'{where}.figure')
        if not lines and step.get('figure') is None:
            errors.append(f'{where}: expected lines or a figure')
    return errors


def status_errors(ocr, statuses) -> list[str]:
    """Problems of the analysis statuses against the reader's steps: one status per step, nothing else."""
    if type(statuses) is not list:
        return ['$.statuses: expected a list']
    step_ids = [step.get('id') for step in ocr.get('steps', []) if type(step) is dict]
    errors, seen = [], set()
    for i, item in enumerate(statuses):
        where = f'$.statuses[{i}]'
        if type(item) is not dict:
            errors.append(f'{where}: expected an object')
            continue
        errors += [f'{where}.{key}: unexpected field' for key in item if key not in ('id', 'status', 'note', 'correct')]
        if 'correct' in item and (item.get('status') not in ('error', 'consequence') or not _is_text(item['correct'])):
            errors.append(f'{where}.correct: a non-empty record, only for error and consequence steps')
        if item.get('id') not in step_ids:
            errors.append(f'{where}.id: no such step "{item.get("id")}"')
        elif item['id'] in seen:
            errors.append(f'{where}.id: second status for step "{item["id"]}" — one remark per step')
        else:
            seen.add(item['id'])
        if item.get('status') not in STATUSES:
            errors.append(f'{where}.status: expected one of {", ".join(STATUSES)}')
        note = item.get('note')
        if item.get('status') in ('error', 'consequence', 'minor') and not _is_text(note):
            errors.append(f'{where}.note: a short remark is required for status "{item.get("status")}"')
        if item.get('status') == 'ok' and note is not None and not _is_text(note, empty=True):
            errors.append(f'{where}.note: expected a string or null')
    errors += [f'$.statuses: no status for step "{step_id}"' for step_id in step_ids if step_id not in seen]
    return errors


def issue_errors(ocr, items, score=None, max_score=None) -> list[str]:
    """Each analysis error points to a step (or null) and says how many points it took off."""
    step_ids = {step.get('id') for step in ocr.get('steps', []) if type(step) is dict}
    errors, total = [], 0
    for i, item in enumerate(items if type(items) is list else []):
        where = f'$.analysis.errors[{i}]'
        if type(item) is not dict:
            continue
        if item.get('step_id') is not None and item.get('step_id') not in step_ids:
            errors.append(f'{where}.step_id: no such step "{item.get("step_id")}"')
        penalty = item.get('penalty')
        if type(penalty) is not int or penalty < 0 or (max_score is not None and penalty > max_score):
            errors.append(f'{where}.penalty: expected an integer from 0 to the maximum score')
        else:
            total += penalty
    if type(score) is int and type(max_score) is int and 0 <= score <= max_score and total > max_score - score:
        errors.append(f'$.analysis.errors: penalties sum to {total}, more than {max_score} - {score}')
    return errors


def corrected(statuses, corrections) -> list:
    """Statuses with the grader's corrected records added to error and consequence steps; anything else is dropped."""
    fixes = {}
    for item in corrections if type(corrections) is list else []:
        if type(item) is dict and _is_text(item.get('id')) and _is_text(item.get('correct')):
            fixes.setdefault(item['id'], item['correct'].strip())
    return [{**s, 'correct': fixes[s['id']]} if s.get('status') in ('error', 'consequence') and s.get('id') in fixes
            else s for s in statuses]


def _plain(text: str) -> str:
    """Text without what layout may change: spaces, $, \\left/\\right and \\text{} wrappers."""
    text = re.sub(r'\\text\{([^{}]*)\}', r'\1', text)
    return re.sub(r'\s+|\$|\\left|\\right', '', text)


def drift_errors(ocr, reading: str) -> list[str]:
    """Step lines the reader never wrote: each line must appear in the transcript as it is."""
    source = _plain(reading)
    errors = []
    for i, step in enumerate(ocr.get('steps', [])):
        for j, line in enumerate(step.get('lines') or []):
            if _plain(line) and _plain(line) not in source:
                errors.append(f'$.steps[{i}].lines[{j}]: not in the transcript as written: {line[:120]}')
    return errors


def final_errors(response, reader_ocr, task_number=None) -> list[str]:
    """The final response must carry the reader's ocr unchanged and valid statuses for it."""
    if type(response) is not dict:
        return ['$: expected an object']
    if response.get('ocr') != reader_ocr:
        return ['$.ocr: differs from the reader output — the transcript must not change after reading']
    analysis = response.get('analysis') if type(response.get('analysis')) is dict else {}
    return ocr_errors(reader_ocr, task_number) + status_errors(reader_ocr, analysis.get('statuses'))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check the expert-screen JSON of one stage.')
    parser.add_argument('stage', choices=('ocr', 'statuses', 'final'))
    parser.add_argument('file', type=Path)
    parser.add_argument('--ocr', type=Path, help='reader output (for statuses and final)')
    parser.add_argument('--task', type=int, help='task number: its own step types')
    args = parser.parse_args(argv)
    data = json.loads(args.file.read_text(encoding='utf-8'))
    reader = json.loads(args.ocr.read_text(encoding='utf-8')) if args.ocr else None
    if args.stage == 'ocr':
        errors = ocr_errors(data, args.task)
    elif args.stage == 'statuses':
        errors = status_errors(reader or {}, data)
    else:
        errors = final_errors(data, reader, args.task)
    print('\n'.join(errors) if errors else 'OK')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
