"""Expert-screen JSON: the reader's steps, the analysis statuses and the unchanged transcript."""
import copy
import json
from pathlib import Path

from app.grading.expert_json import final_errors, main, ocr_errors, status_errors

EXAMPLE = json.loads((Path(__file__).parents[1] / 'docs' / 'grading' / 'expert-json-example.json')
                     .read_text(encoding='utf-8'))


def test_example_is_valid():
    assert ocr_errors(EXAMPLE['ocr']) == []
    assert status_errors(EXAMPLE['ocr'], EXAMPLE['analysis']['statuses']) == []
    assert final_errors(EXAMPLE, copy.deepcopy(EXAMPLE['ocr'])) == []


def test_sign_must_be_plus_minus_or_zero():
    ocr = copy.deepcopy(EXAMPLE['ocr'])
    ocr['steps'][3]['figure']['arcs'][0]['sign'] = 'plus'
    assert any('sign' in e for e in ocr_errors(ocr))


def test_arc_must_join_known_points_and_a_loop_is_allowed():
    ocr = copy.deepcopy(EXAMPLE['ocr'])
    ocr['steps'][3]['figure']['arcs'].append({'from': 'p3', 'to': 'p3', 'sign': '+', 'selected': False})
    assert ocr_errors(ocr) == []
    ocr['steps'][3]['figure']['arcs'].append({'from': 'p9', 'to': 'p3', 'sign': '+', 'selected': False})
    assert any('.from' in e for e in ocr_errors(ocr))


def test_unknown_step_type_and_extra_field_are_rejected():
    ocr = copy.deepcopy(EXAMPLE['ocr'])
    ocr['steps'][0]['type'] = 'odz_check'
    ocr['steps'][1]['doubt'] = ['>', '≠']
    errors = ocr_errors(ocr)
    assert any('.type' in e for e in errors) and any('doubt' in e for e in errors)


def test_one_status_per_step_and_every_step_has_one():
    statuses = copy.deepcopy(EXAMPLE['analysis']['statuses'])
    statuses.append({'id': 's5', 'status': 'minor', 'note': 'ещё замечание'})
    assert any('one remark per step' in e for e in status_errors(EXAMPLE['ocr'], statuses))
    assert any('no status for step "s7"' in e for e in status_errors(EXAMPLE['ocr'], statuses[:6]))


def test_error_status_needs_a_note():
    statuses = copy.deepcopy(EXAMPLE['analysis']['statuses'])
    statuses[4]['note'] = None
    assert any('.note' in e for e in status_errors(EXAMPLE['ocr'], statuses))


def test_final_response_must_keep_the_reader_ocr():
    changed = copy.deepcopy(EXAMPLE)
    changed['ocr']['steps'][4]['lines'] = ['t \\ge 9']
    assert any('must not change' in e for e in final_errors(changed, EXAMPLE['ocr']))


def test_cli(tmp_path, capsys):
    path = tmp_path / 'ocr.json'
    path.write_text(json.dumps(EXAMPLE['ocr'], ensure_ascii=False), encoding='utf-8')
    assert main(['ocr', str(path)]) == 0
    assert capsys.readouterr().out.strip() == 'OK'


def test_layout_may_not_change_the_transcript():
    from app.grading.expert_json import drift_errors
    reading = r'заметим, что $2^{x^2}-4 \neq 0 \Rightarrow x \neq \pm\sqrt{2}$' + '\n' + r'Ответ: $x \in [1; +\infty)$'
    kept = {'steps': [{'lines': [r'2^{x^2} - 4 \neq 0', r'\text{Ответ: } x \in [1; +\infty)']}]}
    changed = {'steps': [{'lines': [r'2^{x^2} - 4 \neq 0', r'x \in (1; +\infty)']}]}
    assert drift_errors(kept, reading) == []
    assert drift_errors(changed, reading) == [r'$.steps[0].lines[1]: not in the transcript as written: x \in (1; +\infty)']


def test_each_task_has_its_own_step_types():
    from app.grading.expert_json import ocr_errors
    ocr = {'steps': [{'id': 's1', 'type': 'substitution', 'title': 'Замена', 'lines': ['t = 2^x'], 'figure': None}],
           'answer': None}
    assert ocr_errors(ocr, 16) == []
    assert any('.type' in e for e in ocr_errors(ocr, 20))  # no substitution in number theory


def test_error_card_points_to_a_step_and_says_its_penalty():
    from app.grading.expert_json import issue_errors
    ocr = {'steps': [{'id': 's5'}, {'id': 's6'}]}
    lost = {'id': 'e1', 'step_id': 's5', 'penalty': 1}
    assert issue_errors(ocr, [lost, {'id': 'e2', 'step_id': None, 'penalty': 0}], 1, 2) == []
    assert any('step_id' in e for e in issue_errors(ocr, [{**lost, 'step_id': 's9'}], 1, 2))
    assert any('penalty' in e for e in issue_errors(ocr, [{**lost, 'penalty': None}], 1, 2))
    assert any('sum' in e for e in issue_errors(ocr, [lost, {**lost, 'id': 'e2'}], 1, 2))  # 2 taken off, 1 lost


def test_corrected_record_goes_only_to_error_and_consequence_steps():
    from app.grading.expert_json import corrected, status_errors
    statuses = [{'id': 's5', 'status': 'error', 'note': 'Потеряна точка t = 3'},
                {'id': 's6', 'status': 'ok', 'note': None}]
    fixes = [{'id': 's5', 'correct': 't = 3 или t > 9'}, {'id': 's6', 'correct': 'лишнее'}, {'id': 's7'}]
    result = corrected(statuses, fixes)
    assert result[0]['correct'] == 't = 3 или t > 9' and 'correct' not in result[1]
    ocr = {'steps': [{'id': 's5'}, {'id': 's6'}]}
    assert status_errors(ocr, result) == []
    assert any('correct' in e for e in status_errors(ocr, [result[0], {**result[1], 'correct': 'x'}]))


def test_domain_bound_is_a_dashed_point():
    from app.grading.expert_json import ocr_errors
    line = {'kind': 'number_line', 'variable': 't', 'note': 'При t > 0',
            'points': [{'id': 'p1', 'value': '0', 'included': None, 'sign': None, 'bound': True},
                       {'id': 'p2', 'value': '3', 'included': True, 'sign': '0'}],
            'arcs': [{'from': 'p1', 'to': 'p2', 'sign': '-', 'selected': False}]}
    ocr = {'steps': [{'id': 's4', 'type': 'intervals', 'title': 'Метод интервалов', 'lines': [], 'figure': line}],
           'answer': None}
    assert ocr_errors(ocr, 16) == []
    line['points'][1]['included'] = None  # an ordinary point is hollow or filled
    assert any('included' in e for e in ocr_errors(ocr, 16))
