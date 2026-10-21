"""Offline fault injection through the actual source-bound v2 pipeline."""
from collections import defaultdict
import asyncio
from copy import deepcopy
from io import BytesIO
import json
from uuid import uuid4

from PIL import Image
import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading import v2_service as service
from app.grading.images import SafeImage
from app.grading.observability import RunStore
from app.grading.package import MAX_SCORES
from app.grading.service import TaskPreparationError

GOOD = object()


class ScriptedProvider(service.V2MockProvider):
    def __init__(self, scripts=None, transcript=None):
        self.scripts = {name: iter(items) for name, items in (scripts or {}).items()}
        self.calls = defaultdict(int)
        self.transcript = transcript
        self.closed = False

    async def _answer(self, stage):
        self.calls[stage] += 1
        answer = next(self.scripts[stage]) if stage in self.scripts else GOOD
        if isinstance(answer, BaseException):
            raise answer
        return answer

    async def transcribe(self, prompt, *images):
        answer = await self._answer('ocr')
        if answer is not GOOD:
            return answer
        return self.transcript if self.transcript is not None else await super().transcribe(prompt, *images)

    async def chat(self, messages, tools=None, **kwargs):
        system = messages[0]['content']
        stage = ('layout' if 'STAGE: v2_layout' in system else
                 'grading' if 'Анализ завершён: notes.md' in system else
                 'preparation' if system == service.PREP_PROMPT else 'analysis')
        answer = await self._answer(stage)
        return await super().chat(messages, tools, **kwargs) if answer is GOOD else answer

    async def close(self):
        self.closed = True


def setup_run(number=16):
    task = {'id': str(uuid4()), 'task_number': number, 'max_score': MAX_SCORES[number],
            'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}
    image_ids = [str(uuid4())]
    output = BytesIO()
    Image.new('RGB', (40, 30), (170, 50, 20)).save(output, 'PNG')
    images = [SafeImage(output.getvalue(), 'image/png')]
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    trace.solution_image_ids = image_ids
    return task, image_ids, images, trace


async def run(settings, monkeypatch, provider, number=16, values=None):
    task, image_ids, images, trace = values or setup_run(number)
    settings.llm.provider = 'mock'
    monkeypatch.setattr(service, 'V2MockProvider', lambda: provider)
    raw = await service.run_prepared(settings, task, image_ids, images, trace)
    return json.loads(raw), trace


def events(trace, kind=None, phase=None):
    return [e for e in trace.store.events(trace.run_id)['items']
            if (kind is None or e['type'] == kind) and (phase is None or e['phase'] == phase)]


@pytest.mark.parametrize('number', range(14, 21))
async def test_mock_pipeline_all_approved_tasks_preserves_trusted_input(settings, monkeypatch, number):
    provider = ScriptedProvider()
    inputs = setup_run(number)
    expected = deepcopy(inputs[:2])
    result, trace = await run(settings, monkeypatch, provider, values=inputs)
    assert result['task'] == expected[0] and result['solution_image_ids'] == expected[1]
    assert result['grading']['score'] == MAX_SCORES[number]
    assert result['ocr'] == trace.reader_ocr
    assert result['analysis']['statuses'][0]['follows_from_step_ids'] == []
    assert provider.closed
    kinds = [a.metadata['kind'] for a in trace.store._runs[trace.run_id].artifacts.values()]
    assert sorted(kinds) == ['analysis', 'grading', 'ocr']  # The HTTP boundary alone stores final.


@pytest.mark.parametrize('bad', [
    {'content': '{"analysis":'}, {'content': '[]'}, {'content': None},
    {'content': '{"grading":{},"grading":{}}'},
    {'content': 'x' * (service.MAX_RESPONSE_BYTES + 1)},
    {'content': '{}', 'tool_calls': [{'id': 'unexpected'}]},
    {'content': '{"analysis":{"summary":"\\ud800"}}'},
    LLMResponseFormatError('truncated'),
])
async def test_bad_first_grade_is_repaired_not_returned(settings, monkeypatch, bad):
    provider = ScriptedProvider({'grading': [bad, GOOD]})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['is_graded'] and provider.calls['grading'] == 2
    assert events(trace, 'validation_failed', 'grading')[0]['data']['attempt'] == 1


async def test_bad_recheck_never_revives_old_grade_and_attempt_facts_match(settings, monkeypatch):
    provider = ScriptedProvider({'grading': [GOOD, {'content': 'bad'}, {'content': 'bad'}, {'content': 'bad'}]},
                                transcript='x > 1\nОтвет: (1; +∞)')
    values = setup_run()
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    trace = values[-1]
    assert provider.calls['grading'] == 4 and provider.closed
    assert [e['data']['attempt'] for e in events(trace, 'validation_failed', 'grading')] == [1, 2, 3, 4]
    assert [e['data']['attempt'] for e in events(trace, 'retry', 'grading')] == [2, 3, 4]
    assert events(trace, 'stage_failed', 'grading') and not events(trace, 'stage_completed', 'grading')
    assert not any(a.metadata['kind'] in ('grading', 'final')
                   for a in trace.store._runs[trace.run_id].artifacts.values())


async def test_recheck_after_repair_shares_the_same_four_attempt_budget(settings, monkeypatch):
    provider = ScriptedProvider({'grading': [{'content': 'bad'}, GOOD, {'content': 'bad'}, {'content': 'bad'}]},
                                transcript='x > 1\nОтвет: (1; +∞)')
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['grading'] == 4


@pytest.mark.parametrize('stage', ['ocr', 'layout', 'analysis', 'grading'])
async def test_transport_dispatch_is_never_replayed(settings, monkeypatch, stage):
    provider = ScriptedProvider({stage: [LLMError('transport uncertain', retryable=False)]})
    values = setup_run()
    with pytest.raises(LLMError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls[stage] == 1 and provider.closed
    assert events(values[-1], 'stage_failed', stage)
    assert not events(values[-1], 'retry', stage)


async def test_failed_strip_join_does_not_fall_back_to_unjoined_text(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, '', '', '', '']})
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['ocr'] == 7 and provider.calls['layout'] == 0


async def test_ocr_vote_transport_failure_stops_before_another_vote(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, GOOD, LLMError('uncertain', retryable=False)]},
                                transcript='x [неразборчиво: > | ≠] 0')
    with pytest.raises(LLMError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['ocr'] == 5


async def test_single_candidate_ocr_is_reread_before_layout(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, 'x [неразборчиво: >] 0',
        '{"reading":"≠"}', '{"reading":null}', '{"reading":"≠"}']})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == ['x ≠ 0']
    assert result['is_graded'] and provider.calls['ocr'] == 7
    assert not events(trace, 'retry', 'ocr')  # Rereading is the first attempt of a distinct step.


async def test_unsettled_single_candidate_stops_before_layout(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, 'x [неразборчиво: >] 0',
        *(['{"reading":">"}', '{"reading":null}', '{"reading":"≠"}'] * 4)]})
    values = setup_run()
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls['ocr'] == 16 and provider.calls['layout'] == 0
    assert provider.calls['analysis'] == provider.calls['grading'] == 0
    assert events(values[-1], 'validation_failed', 'ocr')[-1]['data']['issue_codes'] == ['ocr_doubt_no_consensus']


def layout(ids, *, title='Решение', figure=None):
    return {'content': json.dumps({'steps': [{'id': 's1', 'type': 'other', 'title': title,
                                            'line_ids': ids, 'figure': figure}]})}


@pytest.mark.parametrize('ids,code,detail', [
    (['l1'], 'missing_source_lines', 'l2'),
    (['l1', 'l1', 'l2'], 'duplicate_source_lines', 'l1'),
    (['l1', 'foreign-private-content', 'l2'], 'unknown_source_lines', 'flattened positions 2'),
    (['l2', 'l1'], 'source_line_order', 'position 1'),
])
async def test_layout_repair_gets_specific_coverage_facts_without_mutating_source(
        settings, monkeypatch, ids, code, detail):
    class InspectRepair(ScriptedProvider):
        async def chat(self, messages, tools=None, **kwargs):
            if messages[0]['content'] == service.LAYOUT_PROMPT and self.calls['layout'] == 1:
                feedback = messages[-1]['content']
                assert code in feedback and detail in feedback
                assert 'foreign-private-content' not in feedback
            return await super().chat(messages, tools, **kwargs)

    provider = InspectRepair({'layout': [layout(ids), GOOD]})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == ['Демонстрация mock: изображения не распознавались.', 'x > 0']
    assert provider.calls['layout'] == 2
    failure = events(trace, 'validation_failed', 'layout')[0]
    assert code in failure['data']['issue_codes']
    assert 'foreign-private-content' not in json.dumps(failure)


async def test_coverage_failure_exhausts_without_autofilling_or_sorting(settings, monkeypatch):
    provider = ScriptedProvider({'layout': [layout(['l2', 'l1'])] * 4})
    values = setup_run()
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls['layout'] == 4 and provider.calls['analysis'] == provider.calls['grading'] == 0
    assert values[-1].reader_ocr is None
    assert [e['data']['issue_codes'] for e in events(values[-1], 'validation_failed', 'layout')] == [
        ['source_line_order']] * 4


def truncated(limit=16000):
    return LLMResponseFormatError('incomplete', details={
        'provider_failure': 'provider_output_truncated', 'output_limit': limit})


async def test_analysis_truncation_uses_one_existing_slot_with_larger_budget(settings, monkeypatch):
    class BudgetProvider(ScriptedProvider):
        async def chat(self, messages, tools=None, **kwargs):
            if messages[0]['content'] == service.ANALYSIS_PROMPT + service.CAUSAL_STEPS_RULE:
                if self.calls['analysis'] == 0:
                    assert 'max_output_tokens' not in kwargs
                else:
                    assert kwargs['max_output_tokens'] == 32000
                    assert len(messages) == 2  # Truncation is not a prompt-format error.
            return await super().chat(messages, tools, **kwargs)

    provider = BudgetProvider({'analysis': [truncated(), GOOD]})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['is_graded'] and provider.calls['analysis'] == 2
    assert events(trace, 'model_failed', 'analysis')[0]['data']['error_code'] == 'provider_output_truncated'
    retry = events(trace, 'retry', 'analysis')[0]['data']
    assert retry['attempt'] == 2 and retry['max_attempts'] == 4
    assert retry['reason_code'] == 'provider_output_truncated'


@pytest.mark.parametrize('answers,expected_calls', [
    ([truncated(), truncated(32000), truncated(32000), truncated(32000)], 4),
    ([truncated(32000)] * 4, 4),
    ([truncated(64000)] * 4, 4),
    ([{'content': 'bad'}, {'content': 'bad'}, truncated(), truncated(32000)], 4),
])
async def test_analysis_truncation_never_repeats_exhausted_budget(settings, monkeypatch, answers, expected_calls):
    provider = ScriptedProvider({'analysis': answers})
    with pytest.raises(LLMResponseFormatError) as error:
        await run(settings, monkeypatch, provider)
    assert error.value.details['provider_failure'] == 'provider_output_truncated'
    assert provider.calls['analysis'] == expected_calls and provider.calls['grading'] == 0


async def test_truncation_after_format_error_shares_original_repair_budget(settings, monkeypatch):
    valid = {'content': 'СТАТУС: подходит\nШАГИ:\ns1: ok\n\nОписание: тест интерфейса. Ошибки: нет.'}
    provider = ScriptedProvider({'analysis': [{'content': 'bad'}, truncated(), valid]})
    result, _ = await run(settings, monkeypatch, provider)
    assert result['is_graded'] and provider.calls['analysis'] == 3


@pytest.mark.parametrize('failure', [LLMError('uncertain', retryable=False), asyncio.CancelledError()])
async def test_transport_error_after_budget_increase_is_not_replayed(settings, monkeypatch, failure):
    provider = ScriptedProvider({'analysis': [truncated(), failure]})
    with pytest.raises(type(failure)):
        await run(settings, monkeypatch, provider)
    assert provider.calls['analysis'] == 2 and provider.calls['grading'] == 0
    assert provider.closed


async def test_empty_choices_use_format_repair_without_budget_escalation(settings, monkeypatch):
    class NoEscalation(ScriptedProvider):
        async def chat(self, messages, tools=None, **kwargs):
            assert 'max_output_tokens' not in kwargs
            return await super().chat(messages, tools, **kwargs)

    empty = LLMResponseFormatError('empty', details={'provider_failure': 'provider_empty_choices', 'output_limit': 16000})
    valid = {'content': 'СТАТУС: подходит\nШАГИ:\ns1: ok\n\nОписание: тест интерфейса. Ошибки: нет.'}
    provider = NoEscalation({'analysis': [empty, valid]})
    result, _ = await run(settings, monkeypatch, provider)
    assert result['is_graded'] and provider.calls['analysis'] == 2


@pytest.mark.parametrize('bad', [layout(['l1']), layout(['l2', 'l1']), layout(['l1', 'l1', 'l2']),
                               layout(['l1', 'invented']), layout(['l1', 'l2'], title='\ud800')])
async def test_layout_repairs_missing_repeated_reordered_or_unencodable_sources(settings, monkeypatch, bad):
    provider = ScriptedProvider({'layout': [bad, GOOD]})
    result, _ = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == ['Демонстрация mock: изображения не распознавались.', 'x > 0']
    assert provider.calls['layout'] == 2


@pytest.mark.parametrize('stage', ['layout', 'analysis'])
async def test_stage_exhaustion_emits_failed_never_completed(settings, monkeypatch, stage):
    provider = ScriptedProvider({stage: [{'content': 'bad'}] * 4})
    values = setup_run()
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls[stage] == 4
    assert events(values[-1], 'stage_failed', stage)
    assert not events(values[-1], 'stage_completed', stage)


async def test_mixed_formula_and_diagram_is_one_step_with_original_crop(settings, monkeypatch):
    settings.local_demo_ai.figures_enabled = True
    values = setup_run(18)
    box = {'x': 0.25, 'y': 0.2, 'width': 0.5, 'height': 0.6}
    figure = {'source_image_id': values[1][0], 'bbox': box, 'alt': 'Чертёж ученика'}
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure)]})
    result, trace = await run(settings, monkeypatch, provider, values=values)
    assert len(result['ocr']['steps']) == len(result['analysis']['statuses']) == len(result['artifacts']) == 1
    step, metadata = result['ocr']['steps'][0], result['artifacts'][0]
    assert len(step['lines']) == 2 and step['figure']['artifact_id'] == metadata['id']
    assert metadata['source_image_id'] == values[1][0] and metadata['bbox'] == box
    with Image.open(BytesIO(trace.store.artifact(trace.run_id, metadata['id']).data)) as crop:
        assert crop.size == (20, 18)
        assert all(abs(a - b) <= 3 for a, b in zip(crop.getpixel((5, 5)), (170, 50, 20)))


@pytest.mark.parametrize('number,figure', [
    (16, {'kind': 'number_line', 'variable': 'x', 'note': None,
          'points': [{'id': 'p1', 'value': '0', 'included': False, 'sign': None},
                     {'id': 'p2', 'value': '1', 'included': None, 'sign': None, 'bound': True}],
          'arcs': [{'from': '-inf', 'to': 'p1', 'sign': '-', 'selected': False},
                   {'from': 'p1', 'to': 'p2', 'sign': '+', 'selected': True},
                   {'from': 'p2', 'to': '+inf', 'sign': '+', 'selected': False}]}),
    (14, {'kind': 'unit_circle',
          'points': [{'id': 'p1', 'value': 'π/2', 'included': True, 'sign': None},
                     {'id': 'p2', 'value': 'π', 'included': False, 'sign': None}],
          'arcs': [{'from': 'p1', 'to': 'p2', 'sign': None, 'selected': True,
                    'direction': 'ccw', 'full_circle': False}]}),
])
async def test_structured_number_line_and_circle_remain_editable_with_same_step(settings, monkeypatch, number, figure):
    settings.local_demo_ai.figures_enabled = True
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure)]})
    result, trace = await run(settings, monkeypatch, provider, number)
    assert result['ocr']['steps'][0]['figure'] == figure
    assert len(result['ocr']['steps']) == len(result['analysis']['statuses']) == 1
    assert result['artifacts'] == trace.diagram_metadata == []


async def test_structured_figure_invalid_reference_is_repaired_before_analysis(settings, monkeypatch):
    settings.local_demo_ai.figures_enabled = True
    figure = {'kind': 'unit_circle', 'points': [],
              'arcs': [{'from': 'missing', 'to': '+inf', 'sign': None, 'selected': True,
                        'direction': 'cw', 'full_circle': False}]}
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure), GOOD]})
    await run(settings, monkeypatch, provider, 14)
    assert provider.calls['layout'] == 2 and provider.calls['analysis'] == 1


def circle_figure():
    return {'kind': 'unit_circle',
            'points': [{'id': 'p1', 'value': '0', 'included': True, 'sign': '+'},
                       {'id': 'p2', 'value': 'π', 'included': False, 'sign': None}],
            'arcs': [{'from': 'p1', 'to': 'p2', 'sign': '-', 'selected': True,
                      'direction': 'cw', 'full_circle': False}]}


async def test_circle_missing_direction_is_repaired_without_default_or_field_loss(settings, monkeypatch):
    settings.local_demo_ai.figures_enabled = True
    good = circle_figure()
    missing = deepcopy(good)
    del missing['arcs'][0]['direction']
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=missing),
                                           layout(['l1', 'l2'], figure=good)]})
    result, trace = await run(settings, monkeypatch, provider, 14)
    assert result['ocr']['steps'][0]['figure'] == good
    assert trace.reader_ocr['steps'][0]['figure'] == good
    assert provider.calls['layout'] == 2 and provider.calls['analysis'] == 1
    assert len(events(trace, 'validation_failed', 'layout')) == 1


@pytest.mark.parametrize('missing', [True, False])
async def test_ambiguous_circle_exhaustion_never_publishes_a_grade(settings, monkeypatch, missing):
    settings.local_demo_ai.figures_enabled = True
    figure = circle_figure()
    if missing:
        del figure['arcs'][0]['direction']
        del figure['arcs'][0]['full_circle']
    else:
        figure['arcs'][0].update(direction=None, full_circle=None)
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure)] * 4})
    values = setup_run(14)
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    trace = values[-1]
    assert provider.calls['layout'] == 4 and provider.calls['analysis'] == provider.calls['grading'] == 0
    assert trace.reader_ocr is None and trace.store._runs[trace.run_id].artifacts == {}
    assert len(events(trace, 'validation_failed', 'layout')) == 4
    assert events(trace, 'stage_failed', 'layout') and not events(trace, 'stage_completed', 'layout')


@pytest.mark.parametrize('field', ['points', 'arcs', 'id', 'value', 'variable', 'note'])
async def test_native_limits_enter_layout_repair_before_analysis(settings, monkeypatch, field):
    settings.local_demo_ai.figures_enabled = True
    good = circle_figure()
    if field in ('variable', 'note'):
        good.update(kind='number_line', variable='x', note=None)
        for arc in good['arcs']:
            del arc['direction']
            del arc['full_circle']
    oversized = deepcopy(good)
    if field == 'points':
        oversized['points'] = [{'id': f'p{i}', 'value': str(i), 'included': True, 'sign': None}
                               for i in range(1, 66)]
    elif field == 'arcs':
        oversized['arcs'] = [deepcopy(good['arcs'][0]) for _ in range(129)]
    elif field in ('id', 'value'):
        oversized['points'][0][field] = 'x' * (129 if field == 'id' else 501)
        if field == 'id':
            oversized['arcs'][0]['from'] = oversized['points'][0]['id']
    else:
        oversized[field] = 'x' * (65 if field == 'variable' else 2001)
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=oversized),
                                           layout(['l1', 'l2'], figure=good)]})
    result, trace = await run(settings, monkeypatch, provider, 14)
    assert result['ocr']['steps'][0]['figure'] == good
    assert provider.calls['layout'] == 2 and provider.calls['analysis'] == 1
    assert len(events(trace, 'validation_failed', 'layout')) == 1


@pytest.mark.parametrize('reference', ['', 's2', 's3', 's1,s1'])
def test_causal_parser_rejects_absent_self_future_duplicate_links(reference):
    ocr = {'steps': [{'id': f's{i}', 'type': 'other', 'title': 'Шаг', 'lines': ['x'], 'figure': None}
                     for i in (1, 2, 3)], 'answer': None}
    text = f'ШАГИ:\ns1: error — Ошибка\ns2: consequence <- {reference} — Следствие\ns3: error — Ошибка\n\nРазбор.'
    assert service._analysis_steps(text, ocr)[2]


async def test_rejected_manual_reference_never_reads_student_images(settings, monkeypatch):
    provider = ScriptedProvider({'preparation': [{'content': json.dumps({
        'status': 'unclear', 'statement': None, 'reference_answer': None, 'reference_solution': None})}]})
    monkeypatch.setattr(service, 'V2MockProvider', lambda: provider)
    task, image_ids, images, trace = setup_run()
    metadata = {'task_id': task['id'], 'task_number': 16, 'solution_image_ids': image_ids}
    with pytest.raises(TaskPreparationError):
        await service.run_from_images(settings, metadata, images[0], images, trace)
    assert provider.calls['preparation'] == 1 and provider.calls['ocr'] == 0 and provider.closed


async def test_cancellation_closes_provider_and_emits_failed_call(settings, monkeypatch):
    import asyncio
    provider = ScriptedProvider({'layout': [asyncio.CancelledError()]})
    values = setup_run()
    with pytest.raises(asyncio.CancelledError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.closed and events(values[-1], 'model_failed', 'layout')
    assert not events(values[-1], 'stage_completed', 'layout')


async def test_unicode_ocr_retry_returns_tex_without_layout_rewriting(settings, monkeypatch):
    bad = '(x³ + x² - x - 1) / (4ˣ² - 8·2ˣ² + 16) ≥ 0'
    good = r'$\frac{x^{3}+x^{2}-x-1}{4^{x^{2}}-8\cdot2^{x^{2}}+16}\ge0$'
    provider = ScriptedProvider({'ocr': [bad, good, good, good, good]})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == [good]
    assert provider.calls['ocr'] == 5
    assert len(events(trace, 'validation_failed', 'ocr')) == 1


async def test_persistent_unicode_ocr_stops_before_layout(settings, monkeypatch):
    provider = ScriptedProvider(transcript='$4ˣ²$')
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['ocr'] == 4 and provider.calls['layout'] == 0


@pytest.mark.parametrize('kind,marker', [('number_line', 'интервальная прямая'),
    ('unit_circle', 'тригонометрическая окружность')])
async def test_explicit_diagram_requires_native_figure_without_losing_source(settings, monkeypatch, kind, marker):
    settings.local_demo_ai.figures_enabled = True
    text = f'x>0\n[{marker}: отмечена точка 0]'
    figure = {'kind': kind, 'points': [{'id': 'p1', 'value': '0', 'included': False, 'sign': None}], 'arcs': []}
    if kind == 'number_line':
        figure.update(variable='x', note=None)
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2']), layout(['l1', 'l2'], figure=figure)]}, transcript=text)
    result, trace = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == text.splitlines()
    assert result['ocr']['steps'][0]['figure'] == figure
    assert provider.calls['layout'] == 2
    assert len(events(trace, 'validation_failed', 'layout')) == 1


async def test_missing_native_figure_exhaustion_stops_before_analysis(settings, monkeypatch):
    settings.local_demo_ai.figures_enabled = True
    provider = ScriptedProvider(transcript='[числовая прямая: отмечена точка 0]')
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['layout'] == 4 and provider.calls['analysis'] == 0


def test_diagram_marker_on_another_step_does_not_cover_missing_figure():
    lines = [{'id': 'l1', 'text': '[числовая прямая: точка 0]'}, {'id': 'l2', 'text': 'x>0'}]
    data = {'steps': [
        {'id': 's1', 'type': 'other', 'title': 'Рисунок', 'line_ids': ['l1'], 'figure': None},
        {'id': 's2', 'type': 'other', 'title': 'Запись', 'line_ids': ['l2'], 'figure':
         {'kind': 'number_line', 'variable': 'x', 'note': None, 'points': [], 'arcs': []}},
    ]}
    assert any('explicit_native_diagram' in error for error in service._layout_errors(data, lines, [], 16))


@pytest.mark.parametrize('kind', [[], {}, None, 'unit_circle'])
async def test_wrong_or_malformed_native_kind_is_repaired(settings, monkeypatch, kind):
    settings.local_demo_ai.figures_enabled = True
    good = {'kind': 'number_line', 'variable': 'x', 'note': None, 'points': [], 'arcs': []}
    bad = {**good, 'kind': kind}
    provider = ScriptedProvider({'layout': [layout(['l1'], figure=bad), layout(['l1'], figure=good)]},
                                transcript='[числовая прямая: без отметок]')
    result, _ = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['figure'] == good
    assert provider.calls['layout'] == 2


async def test_join_notation_is_retried_and_keeps_original_tex_terms(settings, monkeypatch):
    good = r'$\frac{x+1}{x-1}$'
    provider = ScriptedProvider({'ocr': [good, good, good, '(x+1)/(x-1)', good]})
    result, _ = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == [good]
    assert provider.calls['ocr'] == 5


@pytest.mark.parametrize('stage', ['preparation', 'ocr', 'layout', 'analysis', 'grading'])
@pytest.mark.parametrize('succeeds', [True, False])
async def test_each_stage_has_four_shared_attempts_without_replaying_predecessors(
        settings, monkeypatch, stage, succeeds):
    from unittest.mock import AsyncMock
    from app.core.errors import LLMTimeoutError
    from app.grading import retry
    monkeypatch.setattr(retry.asyncio, 'sleep', AsyncMock())
    malformed = '' if stage == 'ocr' else {'content': 'invalid'}
    good = ({'content': 'СТАТУС: подходит\nШАГИ:\ns1: ok\n\nОписание: тест интерфейса. Ошибки: нет.'}
            if stage == 'analysis' else GOOD)
    faults = [
        LLMTimeoutError('Timeout', retryable=True, details={'provider_failure': 'provider_timeout'}),
        malformed,
        LLMError('Disconnected', retryable=True, details={'provider_failure': 'provider_connection_error'}),
        good if succeeds else malformed,
    ]
    # Fail the second strip: the first strip must never be called again.
    scripted = [GOOD, *faults, GOOD, GOOD] if stage == 'ocr' else faults
    provider = ScriptedProvider({stage: scripted})
    values = setup_run()
    task, image_ids, images, trace = values
    monkeypatch.setattr(service, 'V2MockProvider', lambda: provider)
    settings.llm.provider = 'mock'

    async def execute():
        if stage == 'preparation':
            metadata = {'task_id': task['id'], 'task_number': 16, 'solution_image_ids': image_ids}
            return await service.run_from_images(settings, metadata, images[0], images, trace)
        return await service.run_prepared(settings, task, image_ids, images, trace)

    if succeeds:
        result = json.loads(await execute())
        assert result['is_graded'] and result['grading']['score'] == 2
    else:
        with pytest.raises(LLMResponseFormatError) as caught:
            await execute()
        assert caught.value.details['attempt'] == 4
        assert caught.value.details['exhausted'] is True
        assert caught.value.details['failure_counts'] == {'network': 2, 'model_response': 2}
        assert not events(trace, 'stage_completed', stage)
        assert not any(a.metadata['kind'] in ('grading', 'final')
                       for a in trace.store._runs[trace.run_id].artifacts.values())
    target_step = 'ocr.photo.1.strip.2' if stage == 'ocr' else stage
    starts = [e for e in events(trace, 'model_started', stage) if e['data']['step'] == target_step]
    assert [e['data']['attempt'] for e in starts] == [1, 2, 3, 4]
    assert starts[-1]['data']['failure_counts'] == {'network': 2, 'model_response': 1}
    assert all(e['data']['max_attempts'] == 4 for e in starts)
    assert len(events(trace, 'retry', stage)) == 3
    expected = {'preparation': 0, 'ocr': 4, 'layout': 1, 'analysis': 1, 'grading': 1}
    if stage == 'preparation':
        expected['preparation'] = 4
    elif stage == 'ocr':
        expected['ocr'] = 7 if succeeds else 5
    else:
        expected[stage] = 4
    if not succeeds:
        stages = ['preparation', 'ocr', 'layout', 'analysis', 'grading']
        for later in stages[stages.index(stage) + 1:]:
            expected[later] = 0
    assert {name: provider.calls[name] for name in expected} == expected
    assert provider.closed


@pytest.mark.parametrize('stage', ['ocr', 'layout', 'analysis', 'grading'])
async def test_cancellation_never_consumes_a_retry_or_replays_previous_stage(settings, monkeypatch, stage):
    provider = ScriptedProvider({stage: [asyncio.CancelledError()]})
    values = setup_run()
    with pytest.raises(asyncio.CancelledError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls[stage] == 1 and provider.closed
    assert not events(values[-1], 'retry', stage)
    assert not events(values[-1], 'stage_completed', stage)


async def test_join_fourth_success_does_not_reread_any_strip(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, '', '', '', GOOD]})
    result, trace = await run(settings, monkeypatch, provider)
    assert result['is_graded'] and provider.calls['ocr'] == 7
    started = events(trace, 'model_started', 'ocr')
    strips = [e['data']['step'] for e in started if '.strip.' in e['data']['step']]
    assert strips == ['ocr.photo.1.strip.1', 'ocr.photo.1.strip.2', 'ocr.photo.1.strip.3']
    assert [e['data']['attempt'] for e in started if e['data']['step'] == 'ocr.join'] == [1, 2, 3, 4]


@pytest.mark.parametrize('failure', [asyncio.CancelledError(), LLMError('Do not retry', retryable=False)])
async def test_preparation_cancellation_or_nonretryable_failure_never_starts_ocr(settings, monkeypatch, failure):
    provider = ScriptedProvider({'preparation': [failure]})
    task, image_ids, images, trace = setup_run()
    monkeypatch.setattr(service, 'V2MockProvider', lambda: provider)
    settings.llm.provider = 'mock'
    metadata = {'task_id': task['id'], 'task_number': 16, 'solution_image_ids': image_ids}
    with pytest.raises(type(failure)):
        await service.run_from_images(settings, metadata, images[0], images, trace)
    assert provider.calls['preparation'] == 1 and provider.calls['ocr'] == 0 and provider.closed
    assert not events(trace, 'retry', 'preparation')


@pytest.mark.parametrize('stage', ['preparation', 'ocr', 'layout', 'analysis', 'grading'])
@pytest.mark.parametrize('succeeds', [True, False])
async def test_real_katex_retries_only_producing_stage_up_to_four(settings, monkeypatch, stage, succeeds):
    bad = r'$\frac{1}{$'
    class TexFaultProvider(ScriptedProvider):
        async def transcribe(self, prompt, *images):
            result = await super().transcribe(prompt, *images)
            return bad if stage == 'ocr' and self.calls['ocr'] <= (3 if succeeds else 4) else result
        async def chat(self, messages, tools=None, **kwargs):
            result = await super().chat(messages, tools, **kwargs)
            system = messages[0]['content']
            current = ('layout' if 'STAGE: v2_layout' in system else 'grading' if 'Анализ завершён: notes.md' in system
                       else 'preparation' if system == service.PREP_PROMPT else 'analysis')
            if current != stage or self.calls[current] > (3 if succeeds else 4):
                if current == 'analysis':
                    return {'content': 'СТАТУС: подходит\nШАГИ:\ns1: ok\n\nРешение проверено'}
                return result
            if current == 'analysis':
                return {'content': 'СТАТУС: подходит\nШАГИ:\ns1: ok\n\nРешение: ' + bad}
            data = json.loads(result['content'])
            if current == 'layout': data['steps'][0]['title'] = bad
            elif current == 'preparation': data['statement'] = bad
            else: data['grading']['explanation'] = bad
            return {'content': json.dumps(data)}
    provider = TexFaultProvider()
    inputs = setup_run()
    task, image_ids, images, trace = inputs
    monkeypatch.setattr(service, 'V2MockProvider', lambda: provider)
    async def execute():
        if stage == 'preparation':
            return await service.run_from_images(settings, {'task_id': task['id'], 'task_number': 16,
                                                           'solution_image_ids': image_ids}, images[0], images, trace)
        return await service.run_prepared(settings, task, image_ids, images, trace)
    if succeeds:
        assert json.loads(await execute())['is_graded']
    else:
        with pytest.raises(LLMResponseFormatError) as caught:
            await execute()
        assert caught.value.details['diagnostic_code'] == 609
        assert caught.value.details['attempt'] == 4
        assert caught.value.details['failure_counts'] == {'model_response': 4}
    assert len(events(trace, 'retry', stage)) == 3
    if stage not in ('preparation', 'ocr'): assert provider.calls['ocr'] == 4
    if stage == 'grading': assert provider.calls['analysis'] == 1 and provider.calls['layout'] == 1
    if stage == 'analysis': assert provider.calls['layout'] == 1


async def test_katex_infrastructure_failure_never_retries_model(settings, monkeypatch):
    from app.grading.tex_validation import TexValidatorUnavailable
    provider = ScriptedProvider()
    monkeypatch.setattr('app.grading.tex_validation.shutil.which', lambda _: None)
    with pytest.raises(TexValidatorUnavailable):
        await run(settings, monkeypatch, provider)
    assert provider.calls == {'ocr': 1}


async def test_figures_default_off_retains_source_description_and_rejects_generated_crop(settings, monkeypatch):
    from app.config import LocalDemoAISettings
    assert LocalDemoAISettings().figures_enabled is False
    text = '[числовая прямая: точка 0 пустая, выделено справа]\n$x>0$'
    inputs = setup_run()
    crop = {'source_image_id': inputs[1][0], 'bbox': {'x': 0, 'y': 0, 'width': 1, 'height': 1}, 'alt': 'Рисунок'}
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=crop), GOOD]}, transcript=text)
    result, trace = await run(settings, monkeypatch, provider, values=inputs)
    assert result['ocr']['steps'][0]['lines'] == text.splitlines()
    assert result['ocr']['steps'][0]['figure'] is None and result['artifacts'] == []
    assert trace.diagram_metadata == [] and provider.calls['layout'] == 2
    assert provider.calls['ocr'] == 4 and provider.calls['analysis'] == 1
