"""Offline fault injection through the actual source-bound v2 pipeline."""
from collections import defaultdict
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


@pytest.mark.parametrize('number', [14, 16, 17, 18])
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
    assert [e['data']['attempt'] for e in events(trace, 'validation_failed', 'grading')] == [2, 3, 4]
    assert [e['data']['attempt'] for e in events(trace, 'retry', 'grading')] == [2, 3, 4]
    assert events(trace, 'stage_failed', 'grading') and not events(trace, 'stage_completed', 'grading')
    assert not any(a.metadata['kind'] in ('grading', 'final')
                   for a in trace.store._runs[trace.run_id].artifacts.values())


async def test_recheck_after_repair_shares_the_same_two_repair_budget(settings, monkeypatch):
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
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, '', '']})
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['ocr'] == 5 and provider.calls['layout'] == 0


async def test_ocr_vote_transport_failure_stops_before_another_vote(settings, monkeypatch):
    provider = ScriptedProvider({'ocr': [GOOD, GOOD, GOOD, GOOD, LLMError('uncertain')]},
                                transcript='x [неразборчиво: > | ≠] 0')
    with pytest.raises(LLMError):
        await run(settings, monkeypatch, provider)
    assert provider.calls['ocr'] == 5


def layout(ids, *, title='Решение', figure=None):
    return {'content': json.dumps({'steps': [{'id': 's1', 'type': 'other', 'title': title,
                                            'line_ids': ids, 'figure': figure}]})}


@pytest.mark.parametrize('bad', [layout(['l1']), layout(['l2', 'l1']), layout(['l1', 'l1', 'l2']),
                               layout(['l1', 'invented']), layout(['l1', 'l2'], title='\ud800')])
async def test_layout_repairs_missing_repeated_reordered_or_unencodable_sources(settings, monkeypatch, bad):
    provider = ScriptedProvider({'layout': [bad, GOOD]})
    result, _ = await run(settings, monkeypatch, provider)
    assert result['ocr']['steps'][0]['lines'] == ['Демонстрация mock: изображения не распознавались.', 'x > 0']
    assert provider.calls['layout'] == 2


@pytest.mark.parametrize('stage', ['layout', 'analysis'])
async def test_stage_exhaustion_emits_failed_never_completed(settings, monkeypatch, stage):
    provider = ScriptedProvider({stage: [{'content': 'bad'}] * 3})
    values = setup_run()
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    assert provider.calls[stage] == 3
    assert events(values[-1], 'stage_failed', stage)
    assert not events(values[-1], 'stage_completed', stage)


async def test_mixed_formula_and_diagram_is_one_step_with_original_crop(settings, monkeypatch):
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
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure)]})
    result, trace = await run(settings, monkeypatch, provider, number)
    assert result['ocr']['steps'][0]['figure'] == figure
    assert len(result['ocr']['steps']) == len(result['analysis']['statuses']) == 1
    assert result['artifacts'] == trace.diagram_metadata == []


async def test_structured_figure_invalid_reference_is_repaired_before_analysis(settings, monkeypatch):
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
    figure = circle_figure()
    if missing:
        del figure['arcs'][0]['direction']
        del figure['arcs'][0]['full_circle']
    else:
        figure['arcs'][0].update(direction=None, full_circle=None)
    provider = ScriptedProvider({'layout': [layout(['l1', 'l2'], figure=figure)] * 3})
    values = setup_run(14)
    with pytest.raises(LLMResponseFormatError):
        await run(settings, monkeypatch, provider, values=values)
    trace = values[-1]
    assert provider.calls['layout'] == 3 and provider.calls['analysis'] == provider.calls['grading'] == 0
    assert trace.reader_ocr is None and trace.store._runs[trace.run_id].artifacts == {}
    assert len(events(trace, 'validation_failed', 'layout')) == 3
    assert events(trace, 'stage_failed', 'layout') and not events(trace, 'stage_completed', 'layout')


@pytest.mark.parametrize('field', ['points', 'arcs', 'id', 'value', 'variable', 'note'])
async def test_native_limits_enter_layout_repair_before_analysis(settings, monkeypatch, field):
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
