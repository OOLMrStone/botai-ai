"""Malformed model JSON must be repairable data, never a validator exception or a grade."""
from copy import deepcopy
import json

import pytest

from app.grading.expert_json import (
    corrected, drift_errors, final_errors, issue_errors, main, ocr_errors, status_errors,
)
from app.grading.validator import ValidationGate, parse_json, validate_response


@pytest.fixture
def response():
    return {
        'task': {'id': 't1', 'task_number': 16, 'max_score': 2, 'statement': 'x > 0',
                 'reference_answer': '(0; +∞)', 'reference_solution': None},
        'solution_image_ids': ['image-1'], 'is_graded': True, 'rejection_reason': '',
        'ocr': {'steps': [
            {'id': 's1', 'type': 'intervals', 'title': 'Метод интервалов', 'lines': [],
             'figure': {'kind': 'number_line', 'variable': 'x', 'note': None,
                        'points': [{'id': 'p1', 'value': '0', 'included': True, 'sign': None}],
                        'arcs': [{'from': 'p1', 'to': '+inf', 'sign': '+', 'selected': True}]}},
            {'id': 's2', 'type': 'answer', 'title': 'Ответ', 'lines': ['[0; +∞)'], 'figure': None},
        ], 'answer': '[0; +∞)'},
        'analysis': {
            'summary': 'Неверно включена граница.',
            'checks': {'domain': None, 'transformations': None,
                       'completeness': {'is_complete': True, 'reason': 'Решение закончено'}},
            'student_answer': {'text': '[0; +∞)', 'is_correct': False},
            'errors': [{'id': 'e1', 'code': None, 'description': 'Включена граница',
                        'where': '[0; +∞)', 'correct_version': '(0; +∞)', 'advice': '',
                        'step_id': 's1', 'penalty': 1}],
            'strengths': [],
            'statuses': [
                {'id': 's1', 'status': 'error', 'note': 'Включена граница', 'correct': 'x > 0'},
                {'id': 's2', 'status': 'consequence', 'note': 'Следствие ошибки', 'correct': '(0; +∞)'},
            ],
        },
        'grading': {'score': 1, 'criterion': 'Ошибка в границе', 'explanation': 'Включена лишняя точка'},
    }


def at(value, path):
    for key in path:
        value = value[key]
    return value


def paths(value, path=()):
    yield path
    if type(value) is dict:
        for key, item in value.items():
            yield from paths(item, (*path, key))
    elif type(value) is list:
        for index, item in enumerate(value):
            yield from paths(item, (*path, index))


def test_every_json_type_is_handled_at_every_response_position(response):
    """A malformed type at any nested position returns errors instead of aborting repair."""
    assert validate_response(response) == []
    for path in paths(response):
        for replacement in (None, [], {}, True, 1, ''):
            candidate = deepcopy(response)
            if path:
                at(candidate, path[:-1])[path[-1]] = replacement
            else:
                candidate = replacement
            raw = json.dumps(candidate, ensure_ascii=False)
            gate = ValidationGate()
            errors = gate.validate(raw)
            assert type(errors) is list, (path, replacement)
            if errors:
                with pytest.raises(ValueError):
                    gate.finalize(raw)


@pytest.mark.parametrize('value', [None, [], {}, True, 1, '', {'steps': None}, {'steps': [None]},
                                   {'steps': [{'id': []}]}])
def test_stage_validators_are_total_for_malformed_roots(value):
    assert type(ocr_errors(value, [])) is list
    assert type(status_errors(value, [])) is list
    assert type(issue_errors(value, [])) is list
    assert type(drift_errors(value, 'x > 0')) is list
    assert type(final_errors({'ocr': value, 'analysis': {'statuses': []}}, value)) is list


@pytest.mark.parametrize('path', [
    ('ocr', 'answer'), ('ocr', 'steps', 1, 'figure'),
    ('ocr', 'steps', 0, 'figure', 'note'),
    ('ocr', 'steps', 0, 'figure', 'points', 0, 'sign'),
    ('ocr', 'steps', 0, 'figure', 'arcs', 0, 'sign'),
    ('analysis', 'statuses', 0, 'note'), ('analysis', 'errors', 0, 'step_id'),
])
def test_required_nullable_members_cannot_be_omitted(response, path):
    del at(response, path[:-1])[path[-1]]
    assert any('missing required' in error for error in validate_response(response))


@pytest.mark.parametrize('lines', [[], [''], [' ', '\n']])
def test_step_needs_a_nonempty_line_or_figure(response, lines):
    response['ocr']['steps'][1]['lines'] = lines
    assert any('expected lines or a figure' in error for error in validate_response(response))
    # A figure-only step remains a valid representation of the student's drawing.
    response['ocr']['steps'][1]['figure'] = deepcopy(response['ocr']['steps'][0]['figure'])
    assert validate_response(response) == []


def test_corrections_required_only_at_final_grading_boundary(response):
    for status in response['analysis']['statuses']:
        del status['correct']
    assert status_errors(response['ocr'], response['analysis']['statuses']) == []
    errors = validate_response(response)
    assert len([error for error in errors if '.correct:' in error]) == 2


@pytest.mark.parametrize('status', ['consequence', 'minor'])
def test_consequence_and_minor_cards_cannot_take_points(response, status):
    item = response['analysis']['statuses'][0]
    item['status'] = status
    if status == 'minor':
        del item['correct']
    assert any('.penalty: expected zero' in error for error in validate_response(response))
    response['analysis']['errors'][0]['penalty'] = 0
    assert validate_response(response) == []


def test_error_links_cannot_point_to_correct_steps_but_null_is_explicit(response):
    response['analysis']['statuses'][0] = {'id': 's1', 'status': 'ok', 'note': None}
    assert any('.step_id:' in error for error in validate_response(response))
    response['analysis']['errors'][0]['step_id'] = None
    assert validate_response(response) == []


@pytest.mark.parametrize('value', [None, [], {}, True, 1, 'bad'])
def test_malformed_correction_inputs_do_not_crash(value):
    # Bad items are preserved so the final validator can reject them, not silently dropped.
    assert corrected([value], []) == [value]


@pytest.mark.parametrize('raw', ['{"answer":null,"answer":"999"}',
                               '[{"id":"s1","id":"s2"}]', '{"score":NaN}'])
def test_shared_stage_parser_rejects_extended_json(raw):
    with pytest.raises(ValueError):
        parse_json(raw)


def test_cli_checks_full_final_contract_and_ocr_identity(response, tmp_path, capsys):
    reader = tmp_path / 'reader.json'
    output = tmp_path / 'response.json'
    reader.write_text(json.dumps(response['ocr']), encoding='utf-8')
    output.write_text(json.dumps(response), encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader), '--task', '16']) == 0
    response['grading']['score'] = 999
    output.write_text(json.dumps(response), encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader), '--task', '16']) == 1
    assert '$.grading.score' in capsys.readouterr().out
    response['grading']['score'] = 1
    response['ocr']['answer'] = '999'
    output.write_text(json.dumps(response), encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader)]) == 1
    assert 'must not change' in capsys.readouterr().out
    del response['task']
    output.write_text(json.dumps(response), encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader)]) == 1
    assert '$.task: missing required' in capsys.readouterr().out


def test_cli_status_array_uses_strict_parser_and_requires_reader(response, tmp_path, capsys):
    reader = tmp_path / 'reader.json'
    statuses = tmp_path / 'statuses.json'
    reader.write_text(json.dumps(response['ocr']), encoding='utf-8')
    statuses.write_text(json.dumps(response['analysis']['statuses']), encoding='utf-8')
    assert main(['statuses', str(statuses), '--ocr', str(reader)]) == 0
    assert main(['statuses', str(statuses)]) == 1
    statuses.write_text('[{"id":"s1","id":"s2"}]', encoding='utf-8')
    assert main(['statuses', str(statuses), '--ocr', str(reader)]) == 1
    assert 'duplicate key' in capsys.readouterr().out


def test_final_cli_checks_exact_text_and_selected_task(response, tmp_path, capsys):
    reader, output = tmp_path / 'reader.json', tmp_path / 'response.json'
    reader.write_text(json.dumps(response['ocr']), encoding='utf-8')
    output.write_text(json.dumps(response) + '\n', encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader)]) == 1
    assert 'nothing outside' in capsys.readouterr().out
    output.write_text(json.dumps(response), encoding='utf-8')
    assert main(['final', str(output), '--ocr', str(reader), '--task', '14']) == 1
    assert '$.task.task_number: expected 14' in capsys.readouterr().out


def test_cli_reports_unreadable_or_malformed_input(tmp_path, capsys):
    path = tmp_path / 'missing.json'
    assert main(['ocr', str(path)]) == 1
    path.write_text('{"steps":', encoding='utf-8')
    assert main(['ocr', str(path)]) == 1
    assert 'invalid JSON' in capsys.readouterr().out
