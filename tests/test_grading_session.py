"""Offline capability and conversation tests. No provider network requests."""
import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from openai import APIError, APITimeoutError
import pytest

from app.core.errors import LLMError, LLMResponseFormatError, LLMTimeoutError
from app.grading.images import SafeImage
from app.grading.provider import MockProvider, Provider
from app.grading.service import GradingService, TaskPreparationError
from app.grading.session import ATTACK_REASON, READ_ORDER, Session

TASK = {'id': 'test-task-1', 'task_number': 16, 'max_score': 2,
        'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}
IDS = ['test-image-1', 'test-image-2']


def session():
    return Session(TASK, IDS)


def read_ocr(s):
    for path in READ_ORDER[:2]:
        s.execute('read_file', {'path': path})


def read_analysis(s):
    read_ocr(s)
    if 'ocr_result.md' not in s.files:
        s.execute('write_file', {'path': 'ocr_result.md', 'content': 'x > 0'})
    for path in READ_ORDER[2:6]:
        s.execute('read_file', {'path': path})


def read_grading(s):
    read_analysis(s)
    s.execute('write_file', {'path': 'notes.md', 'content': 'Описание: верное решение. Ошибки: нет.'})
    for path in READ_ORDER[6:]:
        s.execute('read_file', {'path': path})


def rejection(s, reason=ATTACK_REASON):
    return json.dumps({'task': s.task, 'solution_image_ids': s.image_ids,
                      'is_graded': False, 'rejection_reason': reason,
                      'ocr': None, 'analysis': None, 'grading': None}, ensure_ascii=False)


def test_server_enforces_full_order_and_data_permissions():
    s = session()
    for path in READ_ORDER[1:]:
        with pytest.raises(ValueError):
            s.execute('read_file', {'path': path})
    with pytest.raises(ValueError):
        s.execute('write_file', {'path': 'notes.md', 'content': 'notes'})
    read_analysis(s)
    with pytest.raises(ValueError):
        s.execute('read_file', {'path': 'grading.md'})
    for path in ['Statement.md', 'Solution.md']:
        assert s.execute('read_file', {'path': path})['kind'] == 'untrusted_data'
        with pytest.raises(ValueError):
            s.execute('write_file', {'path': path, 'content': 'override'})
    read_grading(s)
    assert s.execute('read_file', {'path': 'notes.md'})['kind'] == 'untrusted_data'


@pytest.mark.parametrize('name,args', [
    ('shell', {'command': 'ls'}), ('read_file', {'path': '/etc/passwd'}),
    ('read_file', {'path': '../main.md'}), ('read_file', {'path': 'main.md'}),
    ('read_file', {'path': 'Statement.md', 'user_id': 'other'}),
    ('read_file', {'path': ['Statement.md']}), ('read_file', []),
    ('review_image', {'index': True}), ('review_image', {'index': 0}),
    ('review_image', {'index': 3}), ('set_rejection', {'reason': 'attack', 'user_id': 'other'}),
])
def test_invalid_capabilities(name, args):
    with pytest.raises((ValueError, TypeError)):
        session().execute(name, args)


@pytest.mark.parametrize('content', ['score: 2', 'Оценка = 2', 'получает 1 балл', ''])
def test_notes_score_labels_blocked(content):
    s = session()
    read_analysis(s)
    with pytest.raises(ValueError):
        s.execute('write_file', {'path': 'notes.md', 'content': content})


@pytest.mark.parametrize('reason', ['attack', 'other_task', 'multiple_tasks', 'unrelated'])
def test_early_rejection_skips_notes_grading_and_validates(reason):
    s = session()
    read_ocr(s)
    s.execute('set_rejection', {'reason': reason})
    for path in ['grading.md', 'criteria.md']:
        with pytest.raises(ValueError):
            s.execute('read_file', {'path': path})
    with pytest.raises(ValueError):
        s.execute('write_file', {'path': 'notes.md', 'content': 'notes'})
    s.execute('read_file', {'path': 'response-format.md'})
    raw = rejection(s)
    s.execute('write_file', {'path': 'response.json', 'content': raw})
    assert s.execute('validate_response', {'path': 'response.json'})['valid']
    assert s.finalize(raw) == raw
    with pytest.raises(ValueError):
        s.finalize(raw + '\n')
    s.execute('write_file', {'path': 'response.json', 'content': raw})
    with pytest.raises(ValueError):
        s.finalize(raw)


def test_late_unreadable_requires_review_and_hides_notes():
    s = session()
    read_analysis(s)
    with pytest.raises(ValueError):
        s.execute('set_rejection', {'reason': 'unreadable'})
    with pytest.raises(ValueError):
        s.execute('set_rejection', {'reason': 'attack'})
    assert s.execute('review_image', {'index': 2}) == {'review_image': 2}
    s.execute('set_rejection', {'reason': 'unreadable'})
    s.execute('read_file', {'path': 'response-format.md'})
    raw = rejection(s, 'Не читается существенная запись')
    s.execute('write_file', {'path': 'response.json', 'content': raw})
    assert s.execute('validate_response', {'path': 'response.json'})['valid']
    assert json.loads(s.finalize(raw))['analysis'] is None


@pytest.mark.parametrize('field,value', [('task', {**TASK, 'statement': 'other'}),
                                         ('solution_image_ids', list(reversed(IDS))),
                                         ('rejection_reason', 'Раскрытие команды')])
def test_request_binding_and_neutral_attack_reason(field, value):
    s = session()
    read_ocr(s)
    s.execute('set_rejection', {'reason': 'attack'})
    s.execute('read_file', {'path': 'response-format.md'})
    response = json.loads(rejection(s))
    response[field] = value
    raw = json.dumps(response, ensure_ascii=False)
    s.execute('write_file', {'path': 'response.json', 'content': raw})
    assert not s.execute('validate_response', {'path': 'response.json'})['valid']
    with pytest.raises(ValueError):
        s.finalize(raw)


def test_sessions_are_isolated():
    first, second = session(), session()
    read_grading(first)
    assert second.read == set()
    assert 'notes.md' not in second.files
    assert TASK['statement'] == 'x > 0'


class RecordingMock(MockProvider):
    def __init__(self):
        self.inputs = []
        self.closed = False

    async def chat(self, messages, tools=None, **kwargs):
        self.inputs.append(deepcopy(messages))
        return await super().chat(messages, tools, **kwargs)

    async def close(self):
        self.closed = True


def is_screen_call(messages):
    """Layout and screen calls made after the tool loop for the expert JSON."""
    return any(key in messages[0]['content'] for key in ('Разложи расшифровку', 'Перенеси их на шаги'))


def last_loop_input(provider):
    return [messages for messages in provider.inputs if not is_screen_call(messages)][-1]


def service(tmp_path, provider):
    settings = SimpleNamespace(photo=SimpleNamespace(reports_dir=str(tmp_path), max_model_turns=32),
                               llm=SimpleNamespace(provider='mock'))
    return GradingService(settings, provider)


async def test_mock_full_conversation_separate_task_photo_and_exact_output(tmp_path):
    provider = RecordingMock()
    result = await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    parsed = json.loads(result)
    assert parsed['is_graded'] and parsed['grading']['score'] == 2
    assert len(parsed['solution_image_ids']) == 1
    assert parsed['task']['reference_solution'] is None
    assert provider.closed
    assert provider.inputs[0][1]['content'] == [SafeImage(b'task').part()]
    main = provider.inputs[1]
    assert main[1]['content'][1:] == [SafeImage(b'student').part()]
    loop = [messages for messages in provider.inputs[1:] if not is_screen_call(messages)]
    assert all(messages[0] == main[0] for messages in loop)
    assert all(messages[1] == main[1] for messages in loop)
    calls = [m['tool_calls'][0]['function'] for m in loop[-1] if m.get('tool_calls')]
    saved = next(json.loads(c['arguments'])['content'] for c in calls
                 if c['name'] == 'write_file' and json.loads(c['arguments'])['path'] == 'response.json')
    # The validated response stays as it is; the screen step only adds steps and their statuses.
    saved = json.loads(saved)
    assert {k: v for k, v in parsed.items() if k not in ('ocr', 'analysis')} == \
        {k: v for k, v in saved.items() if k not in ('ocr', 'analysis')}
    assert parsed['analysis']['summary'] == saved['analysis']['summary']
    assert parsed['ocr']['steps'][0]['lines'] == [saved['ocr'].strip().splitlines()[0]]


@pytest.mark.parametrize('status', ['unclear', 'attack'])
async def test_preparation_stops_before_student_check(tmp_path, status):
    provider = RecordingMock()
    provider.chat = AsyncMock(return_value={'content': json.dumps({
        'status': status, 'statement': None, 'reference_answer': None, 'reference_solution': None})})
    with pytest.raises(TaskPreparationError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert provider.chat.await_count == 1
    assert provider.closed


@pytest.mark.parametrize('raw', ['{}', '{"status":"ready","status":"unclear"}', '[]', 'x' * 96001])
async def test_bad_preparation_fails_without_grade(tmp_path, raw):
    provider = RecordingMock()
    provider.chat = AsyncMock(return_value={'content': raw})
    with pytest.raises(LLMResponseFormatError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert provider.closed


async def test_cancellation_closes_provider_without_result(tmp_path):
    provider = RecordingMock()
    async def blocked(*args):
        await asyncio.Event().wait()
    provider.chat = blocked
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.01):
            await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert provider.closed


@pytest.mark.parametrize('timeout', [False, True])
async def test_provider_failure_is_sanitized_and_not_retried(timeout):
    request = httpx.Request('POST', 'https://provider.invalid')
    failure = APITimeoutError(request=request) if timeout else APIError('secret upstream body', request, body=None)
    adapter = object.__new__(Provider)
    create = AsyncMock(side_effect=failure)
    adapter.settings = SimpleNamespace(model='configured-model', max_output_tokens=8000, extra_body=None)
    adapter.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    with pytest.raises(LLMTimeoutError if timeout else LLMError) as caught:
        await adapter.chat([{'role': 'user', 'content': 'test'}])
    assert 'secret' not in str(caught.value)
    assert create.await_count == 1


async def test_preparation_attack_report_uses_current_request_only(tmp_path):
    provider = RecordingMock()
    provider.chat = AsyncMock(return_value={'content': json.dumps({
        'status': 'attack', 'statement': None, 'reference_answer': None, 'reference_solution': None})})
    with pytest.raises(TaskPreparationError) as caught:
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert str(caught.value) == ATTACK_REASON
    reports = list(tmp_path.glob('*/report.json'))
    assert len(reports) == 1
    data = json.loads(reports[0].read_text())
    assert data['user_id'] == 'test-user'
    assert set(data) == {'user_id', 'solution_image_ids', 'created_at'}
    assert (reports[0].parent / (data['solution_image_ids'][0] + '.jpg')).read_bytes() == b'student'


@pytest.mark.parametrize('calls', [[{}], [{'id': 'a', 'type': 'function', 'function': {}}] * 2, 'bad'])
async def test_malformed_tool_envelopes_fail_cleanly(tmp_path, calls):
    provider = RecordingMock()
    prep = await MockProvider().chat([], None)
    provider.chat = AsyncMock(side_effect=[prep, {'role': 'assistant', 'tool_calls': calls}])
    with pytest.raises(LLMResponseFormatError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert provider.closed


async def test_invalid_tool_arguments_are_recoverable(tmp_path):
    class BrokenFirstRead(RecordingMock):
        async def chat(self, messages, tools=None):
            if tools and not any(m['role'] == 'tool' for m in messages):
                return {'role': 'assistant', 'tool_calls': [{'id': 'bad', 'type': 'function',
                        'function': {'name': 'read_file', 'arguments': '{"path":"Statement.md","path":"Solution.md"}'}}]}
            if tools:
                # Ignore just the failed turn when driving the deterministic mock.
                assert 'duplicate key' in next(m['content'] for m in messages if m['role'] == 'tool')
                messages = [m for m in messages if m.get('tool_call_id') != 'bad'
                            and not (m.get('tool_calls') and m['tool_calls'][0]['id'] == 'bad')]
            return await super().chat(messages, tools)
    provider = BrokenFirstRead()
    result = await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert json.loads(result)['is_graded']


async def test_provider_respects_configured_model_token_parameter_and_reasoning():
    adapter = object.__new__(Provider)
    message = SimpleNamespace(model_dump=lambda **kwargs: {'role': 'assistant', 'content': '{}', 'reasoning_content': 'reason'})
    create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=message)]))
    adapter.settings = SimpleNamespace(model='chosen-model', token_param='max_completion_tokens',
                                       max_output_tokens=9000, extra_body={'thinking': {'type': 'enabled'}})
    adapter.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    result = await adapter.chat([{'role': 'user', 'content': 'test'}], [{'type': 'function'}])
    kwargs = create.call_args.kwargs
    assert kwargs['model'] == 'chosen-model'
    assert kwargs['max_completion_tokens'] == 9000 and 'max_tokens' not in kwargs
    assert kwargs['parallel_tool_calls'] is False
    assert kwargs['extra_body'] == adapter.settings.extra_body
    assert result['reasoning_content'] == 'reason'


def test_repeated_review_has_resource_bound():
    s = session()
    read_analysis(s)
    for _ in range(8):
        s.execute('review_image', {'index': 1})
    with pytest.raises(ValueError, match='limit'):
        s.execute('review_image', {'index': 1})


class AttackMock(RecordingMock):
    async def chat(self, messages, tools=None):
        if not tools:
            return await super().chat(messages, tools)
        self.inputs.append(deepcopy(messages))
        request = json.loads(messages[1]['content'][0]['text'])
        for message in messages:
            if message['role'] == 'tool':
                result = json.loads(message['content'])
                if 'request_data' in result:
                    request['task'] = result['request_data']['task']
        raw = json.dumps({**request, 'is_graded': False, 'rejection_reason': ATTACK_REASON,
                          'ocr': None, 'analysis': None, 'grading': None}, ensure_ascii=False)
        sequence = [('read_file', {'path': p}) for p in READ_ORDER[:2]] + [
            ('set_rejection', {'reason': 'attack'}),
            ('set_rejection', {'reason': 'attack'}),
            ('read_file', {'path': 'response-format.md'}),
            ('write_file', {'path': 'response.json', 'content': raw}),
            ('validate_response', {'path': 'response.json'})]
        count = sum(bool(m.get('tool_calls')) for m in messages)
        if count == len(sequence):
            return {'role': 'assistant', 'content': raw}
        name, arguments = sequence[count]
        return {'role': 'assistant', 'tool_calls': [{'id': str(count), 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(arguments, ensure_ascii=False)}}]}


async def test_main_attack_report_once_and_verified_neutral_refusal(tmp_path):
    provider = AttackMock()
    result = json.loads(await service(tmp_path, provider).run(
        SafeImage(b'task'), [SafeImage(b'student')], 'test-user'))
    assert not result['is_graded']
    assert result['rejection_reason'] == ATTACK_REASON
    assert result['grading'] is None
    reports = list(tmp_path.glob('*/report.json'))
    assert len(reports) == 1
    assert json.loads(reports[0].read_text())['solution_image_ids'] == result['solution_image_ids']
    assert not any(json.loads(c['function']['arguments']).get('path') == 'notes.md'
                   for m in provider.inputs[-1] for c in m.get('tool_calls', []))


async def test_report_storage_failure_aborts_instead_of_returning_grade(tmp_path):
    instance = service(tmp_path, AttackMock())
    def failed(*args):
        raise OSError('disk unavailable')
    instance.store.save = failed
    with pytest.raises(OSError):
        await instance.run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert instance.provider.closed


async def test_unvalidated_final_exhausts_budget_without_score(tmp_path):
    provider = RecordingMock()
    prep = await MockProvider().chat([], None)
    provider.chat = AsyncMock(side_effect=[prep] + [{'role': 'assistant', 'content': '{}'}] * 32)
    with pytest.raises(LLMResponseFormatError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert provider.chat.await_count == 33
    assert provider.closed


async def test_reasoning_is_not_sent_back_in_repaired_final_or_tool_turns(tmp_path):
    class ReasoningMock(RecordingMock):
        async def chat(self, messages, tools=None):
            if tools and len(messages) == 2:
                return {'role': 'assistant', 'content': '{}', 'reasoning_content': 'premature-final'}
            if tools:
                assistant_messages = [m for m in messages if m['role'] == 'assistant']
                assert assistant_messages and all('reasoning_content' not in m for m in assistant_messages)
            answer = await super().chat(messages, tools)
            if tools:
                answer['reasoning_content'] = 'tool-reasoning'
            return answer
    provider = ReasoningMock()
    result = await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert json.loads(result)['is_graded']


@pytest.mark.parametrize('configured,expected', [(120, 120), (360, 360), (480, 360), (600, 360), (40, 40)])
def test_provider_timeout_obeys_configuration_and_global_ceiling(monkeypatch, configured, expected):
    calls = []
    def fake_client(**kwargs):
        calls.append(kwargs)
        return object()
    monkeypatch.setattr('app.grading.provider.AsyncOpenAI', fake_client)
    Provider(SimpleNamespace(api_key='test-key', base_url='https://provider.invalid', timeout_s=configured))
    assert calls[0]['timeout'] == expected
    assert calls[0]['max_retries'] == 0


def test_photo_deadline_allows_six_minutes_but_not_more():
    from app.config import PhotoSettings
    from pydantic import ValidationError
    assert PhotoSettings(_env_file=None, deadline_seconds=360).deadline_seconds == 360
    with pytest.raises(ValidationError):
        PhotoSettings(_env_file=None, deadline_seconds=361)


def test_ocr_is_saved_before_reference_and_cannot_be_rewritten():
    s = session()
    read_ocr(s)
    with pytest.raises(ValueError, match='Save ocr_result'):
        s.execute('read_file', {'path': 'analysis.md'})
    with pytest.raises(ValueError):
        s.execute('read_file', {'path': 'Solution.md'})
    s.execute('write_file', {'path': 'ocr_result.md', 'content': 'Исходное чтение'})
    s.execute('read_file', {'path': 'analysis.md'})
    assert TASK['reference_answer'] in s.execute('read_file', {'path': 'Solution.md'})['content']
    with pytest.raises(ValueError, match='immutable'):
        s.execute('write_file', {'path': 'ocr_result.md', 'content': 'Исправленное чтение'})
    assert s.execute('read_file', {'path': 'ocr_result.md'}) == {
        'kind': 'untrusted_data', 'content': 'Исходное чтение'}


def test_grading_freezes_review_and_closes_analysis_tools():
    s = session()
    read_analysis(s)
    for text in ('Первое чтение', 'Уточнённая рецензия'):
        s.execute('write_file', {'path': 'notes.md', 'content': text})
    s.execute('read_file', {'path': 'grading.md'})
    for name, args in [
        ('write_file', {'path': 'notes.md', 'content': 'Поздняя правка'}),
        ('review_image', {'index': 1}),
        ('set_rejection', {'reason': 'unreadable'}),
    ]:
        with pytest.raises(ValueError):
            s.execute(name, args)
    assert s.files['notes.md'] == 'Уточнённая рецензия'


async def test_summary_must_preserve_review_except_internal_error_markers(tmp_path):
    raw = await service(tmp_path, RecordingMock()).run(
        SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    value = json.loads(raw)
    s = Session(value['task'], value['solution_image_ids'])
    read_analysis(s)
    notes = 'Первая строка [E08].\nВторая строка [E12].'
    s.execute('write_file', {'path': 'notes.md', 'content': notes})
    for path in READ_ORDER[6:]:
        s.execute('read_file', {'path': path})
    for summary, expected in [('Пересказ рецензии', False),
                              ('Первая строка.\nВторая строка.', True)]:
        value['analysis']['summary'] = summary
        candidate = json.dumps(value, ensure_ascii=False)
        s.execute('write_file', {'path': 'response.json', 'content': candidate})
        assert s.execute('validate_response', {'path': 'response.json'})['valid'] is expected
        if expected:
            assert s.finalize(candidate) == candidate
        else:
            with pytest.raises(ValueError):
                s.finalize(candidate)


@pytest.mark.parametrize('number, max_score', [(14, 2), (15, 3), (18, 3)])
async def test_service_grades_selected_task_with_its_package(tmp_path, number, max_score):
    provider = RecordingMock()
    result = json.loads(await service(tmp_path, provider).run(
        SafeImage(b'task'), [SafeImage(b'student')], 'test-user', number))
    assert result['is_graded']
    assert result['task']['task_number'] == number and result['task']['max_score'] == max_score
    reads = [m['content'] for m in last_loop_input(provider) if m['role'] == 'tool']
    assert any(f'задания {number}' in r for r in reads)
    # Every task carries the expert-screen structure: steps and one status per step.
    assert result['ocr']['steps'][0]['id'] == 's1'
    assert result['analysis']['statuses'] == [{'id': 's1', 'status': 'ok', 'note': None}]


@pytest.mark.parametrize('number', [21, '15', True, None])
async def test_service_rejects_unsupported_task(tmp_path, number):
    provider = RecordingMock()
    with pytest.raises(ValueError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user', number)
    assert provider.inputs == []


def png(width=400, height=300):
    from io import BytesIO
    from PIL import Image
    output = BytesIO()
    Image.new('RGB', (width, height), 'white').save(output, format='PNG')
    return SafeImage(output.getvalue())


async def test_task_14_runs_reader_then_isolated_stages(tmp_path):
    provider = RecordingMock()
    provider.transcribe = AsyncMock(side_effect=['x = π + πn'] * 3 + ['x = π + πn, n ∈ Z'])
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 14))
    assert result['is_graded']
    package = __import__('app.grading.package', fromlist=['load_package']).load_package(14)
    calls = provider.transcribe.call_args_list
    assert len(calls) == 4  # three strips, then joining and settling doubts on the whole photo
    strip_prompt, resolve = calls[0].args[0], calls[3].args
    assert package['ocr.md'] in strip_prompt and package['ocr_biases.md'] in strip_prompt
    assert 'Демонстрационный пример' not in strip_prompt + resolve[0]  # the statement never reaches the reader
    assert '## Фото 1, полоса 1 из 3\nx = π + πn' in resolve[0] and len(resolve) == 2  # text and the whole photo
    # The final transcript is laid out as steps for the expert screen; the analysis gives each step a status.
    assert result['ocr']['steps'][0]['id'] == 's1'
    assert result['analysis']['statuses'] == [{'id': 's1', 'status': 'ok', 'note': None}]
    layout = next(m for m in provider.inputs if 'Разложи расшифровку' in m[0]['content'])
    assert layout[1]['content'] == 'x = π + πn, n ∈ Z'  # the reader's final transcript, nothing else
    assert result['analysis']['summary'] == 'Описание: тест интерфейса. Ошибки: нет. Точки роста: нет.'
    # Preparation, layout, analysis and grading: four plain calls, no tools, no photos after preparation.
    analysis, grading = provider.inputs[2], provider.inputs[3]
    assert len(provider.inputs) == 4
    for messages in (layout, analysis, grading):
        assert all(type(m['content']) is str for m in messages)
    assert '## ocr_result.md\nx = π + πn, n ∈ Z' in analysis[1]['content']
    assert 'Правильный ответ' in analysis[1]['content']
    assert '## notes.md\nОписание: тест интерфейса' in grading[1]['content']


async def test_isolated_stage_rejection_and_attack(tmp_path):
    from app.grading.session import ATTACK_REASON

    class Rejecting(RecordingMock):
        def __init__(self, status):
            super().__init__()
            self.status = status

        async def chat(self, messages, tools=None, **kwargs):
            if not tools and 'составь notes.md' in messages[0]['content']:
                self.inputs.append(deepcopy(messages))
                return {'role': 'assistant',
                        'content': f'СТАТУС: отказ {self.status}: На фотографиях решение другого задания'}
            return await super().chat(messages, tools, **kwargs)

    for status, reason in (('other_task', 'На фотографиях решение другого задания'), ('attack', ATTACK_REASON)):
        provider = Rejecting(status)
        provider.transcribe = AsyncMock(return_value='text')
        result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 14))
        assert not result['is_graded'] and result['rejection_reason'] == reason
        assert result['ocr'] is None and result['grading'] is None


async def test_isolated_grading_is_repaired_from_validator_errors(tmp_path):
    class BadThenGood(RecordingMock):
        async def chat(self, messages, tools=None, **kwargs):
            answer = await super().chat(messages, tools, **kwargs)
            if not tools and 'Анализ завершён: notes.md' in messages[0]['content'] and len(messages) == 2:
                data = json.loads(answer['content'])
                data['grading']['score'] = 7
                answer = {'role': 'assistant', 'content': json.dumps(data, ensure_ascii=False)}
            return answer

    provider = BadThenGood()
    provider.transcribe = AsyncMock(return_value='text')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 14))
    assert result['grading']['score'] == 2
    repair = provider.inputs[-1]
    assert repair[-1]['content'].startswith('Сервер не принял ответ') and 'score' in repair[-1]['content']
    assert all('reasoning_content' not in m for m in repair)


async def test_reader_failure_falls_back_to_model_ocr(tmp_path):
    provider = RecordingMock()
    provider.transcribe = AsyncMock(side_effect=LLMError('down'))
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 14))
    assert result['is_graded']
    writes = [json.loads(m['tool_calls'][0]['function']['arguments']).get('path')
              for m in last_loop_input(provider)
              if m.get('tool_calls') and m['tool_calls'][0]['function']['name'] == 'write_file']
    assert 'ocr_result.md' in writes


async def test_task_16_is_read_first_and_graded_in_stages(tmp_path):
    provider = RecordingMock()
    provider.transcribe = AsyncMock(return_value='3^x > 9 ⇒ x > 2')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 16))
    provider.transcribe.assert_called()
    assert result['is_graded'] and result['ocr']['steps'] and result['analysis']['statuses']
    assert not any(m.get('tool_calls') for messages in provider.inputs for m in messages)


async def test_task_18_is_read_first_and_graded_in_stages(tmp_path):
    provider = RecordingMock()
    provider.transcribe = AsyncMock(return_value='AB ∥ CD\nОтвет: б) 12')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 18))
    assert result['is_graded'] and result['task']['max_score'] == 3
    provider.transcribe.assert_called()
    assert not any(m.get('role') == 'tool' for messages in provider.inputs for m in messages)  # no tool loop
    assert result['ocr']['steps'][0]['id'] == 's1' and result['analysis']['statuses'][0]['id'] == 's1'


def test_prepared_ocr_result_is_read_first_and_never_rewritten():
    task = {'id': 't', 'task_number': 14, 'max_score': 2, 'statement': 'S',
            'reference_answer': 'A', 'reference_solution': None}
    s = Session(task, ['i1'], reading='## Фото 1\nx = π + πn')
    s.execute('read_file', {'path': 'Statement.md'})
    s.execute('read_file', {'path': 'ocr.md'})
    with pytest.raises(ValueError, match='prepared by the server'):
        s.execute('write_file', {'path': 'ocr_result.md', 'content': 'x = π + 2πn'})
    with pytest.raises(ValueError, match='Read ocr_result.md'):
        s.execute('read_file', {'path': 'analysis.md'})
    assert s.execute('read_file', {'path': 'ocr_result.md'})['content'].endswith('πn')
    s.execute('read_file', {'path': 'analysis.md'})


def test_reader_strips_keep_full_width_and_enlarge_small_scans():
    from io import BytesIO
    from PIL import Image
    from app.grading.reader import strips
    small = [Image.open(BytesIO(s.data)).size for s in strips(png(545, 353))]
    large = [Image.open(BytesIO(s.data)).size for s in strips(png(4000, 300))]
    assert len(small) == 3 and all(w == 2180 for w, _ in small)  # four times, not more
    assert all(w == 4000 for w, _ in large)


def test_prepared_adapter_forbids_reading_by_consistency():
    from app.grading.session import PREPARED_ADAPTER
    assert 'ocr_result.md подготовил сервер' in PREPARED_ADAPTER
    assert 'согласуется с дальнейшими строками' in PREPARED_ADAPTER
    assert 'сохрани ocr_result.md' not in PREPARED_ADAPTER


async def test_provider_logs_token_usage_without_content(monkeypatch, caplog):
    import logging
    from types import SimpleNamespace as NS
    usage = NS(prompt_tokens=100, completion_tokens=32000,
               completion_tokens_details=NS(reasoning_tokens=31000))
    completion = NS(choices=[NS(finish_reason='length', message=None)], usage=usage)

    class Client:
        def __init__(self, **kwargs):
            self.chat = NS(completions=NS(create=AsyncMock(return_value=completion)))
    monkeypatch.setattr('app.grading.provider.AsyncOpenAI', Client)
    provider = Provider(SimpleNamespace(api_key='k', base_url='https://provider.invalid', timeout_s=60,
                                        model='m', max_output_tokens=32000, extra_body=None))
    with caplog.at_level(logging.INFO, logger='app.grading.provider'):
        with pytest.raises(LLMResponseFormatError):
            await provider.chat([{'role': 'user', 'content': 'secret text'}], tools=[{'type': 'function'}])
    record = next(r for r in caplog.records if r.getMessage() == 'llm call')
    assert (record.llm_kind, record.finish_reason, record.completion_tokens, record.reasoning_tokens) == \
        ('tools', 'length', 32000, 31000)
    assert 'secret text' not in caplog.text


def test_analysis_status_line_is_parsed_strictly():
    from app.grading.staged import parse_analysis
    assert parse_analysis('СТАТУС: подходит\nРазбор') == ('ok', '', 'Разбор')
    assert parse_analysis('СТАТУС: отказ unreadable: Не читается') == ('unreadable', 'Не читается', '')
    assert parse_analysis('СТАТУС: подходит') is None  # notes.md is required when the work fits
    assert parse_analysis('{"status": "ok"}') is None
    assert parse_analysis('СТАТУС: отказ maybe: что-то') is None


async def test_photo_is_turned_only_when_both_sheets_agree():
    from io import BytesIO
    from PIL import Image
    from app.grading.reader import upright
    image = png(400, 300)

    def size(safe):
        with Image.open(BytesIO(safe.data)) as opened:
            return opened.size

    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=['2', '4']))  # 90° in both orders
    assert size(await upright(provider, image)) == (300, 400)
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=['2', '1']))  # 90° and 180°: disagree
    assert await upright(provider, image) is image
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=['1', '3']))  # already upright
    assert await upright(provider, image) is image
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=LLMError('down')))
    assert await upright(provider, image) is image


def test_answer_line_is_given_verbatim_only_for_answer_line_tasks():
    from app.grading.staged import answer_block, answer_line
    reading = 'x ∈ (2; 3]\nОтвет: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3)\n'
    assert answer_line(reading) == 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3)'
    assert '«Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3)»' in answer_block({'task_number': 16}, reading)[0]
    assert answer_block({'task_number': 14}, reading) == []
    assert answer_block({'task_number': 16}, 'без ответа') == []


def test_answer_parts_and_recheck():
    from app.grading.staged import answer_parts, answer_recheck
    assert answer_parts(r'Ответ: $(-\infty; 0] \cup (\log_2 3; 2) \cup (2; 3)$') == ['(-∞;0]', '(log23;2)', '(2;3)']
    assert sorted(answer_parts('−1; [1; √2); (√2; +∞)')) == sorted(['[1;√2)', '(√2;∞)', '{-1}'])
    assert sorted(answer_parts('Ответ: x = 1; x ∈ (2; +∞)')) == ['(2;∞)', '{1}']
    task = {'task_number': 16, 'max_score': 2, 'reference_answer': '(-∞;0]; (log_2 3;2); (2;3]'}
    full = {'grading': {'score': 2}}
    note = answer_recheck(task, 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3)', full)
    assert note and 'только в правильном: (2;3]' in note
    assert answer_recheck(task, 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3]', full) is None
    assert answer_recheck(task, 'Ответ: (−∞; 0] ∪ (log₂3; 2) ∪ (2; 3)', {'grading': {'score': 1}}) is None
    assert answer_recheck({**task, 'task_number': 14}, 'Ответ: (2; 3)', full) is None


def test_part_b_value_recheck_for_task_15():
    from app.grading.staged import answer_recheck, answer_value
    assert answer_value('Ответ: V_KBCP = 12.') == '12'
    assert answer_value('б) 12.') == '12'
    assert answer_value('Ответ: 6√3, куб. ед.') == '6√3'
    assert answer_value('Ответ: [зачёркнуто: 12√5/15]  4√5/5') == '4√5/5'
    task = {'task_number': 15, 'max_score': 3, 'reference_answer': 'б) 8:1.'}
    assert answer_recheck(task, 'Ответ: б) 4√2 : 1', {'grading': {'score': 2}})
    assert answer_recheck(task, 'Ответ: 8 : 1', {'grading': {'score': 3}}) is None
    assert answer_recheck(task, 'Ответ: б) 4√2 : 1', {'grading': {'score': 1}}) is None


async def test_task_15_is_read_first_and_graded_in_stages(tmp_path):
    provider = RecordingMock()
    provider.transcribe = AsyncMock(return_value='а) MO ∥ SA ⇒ SA ∥ (OMK)')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 15))
    provider.transcribe.assert_called()
    assert result['is_graded']
    assert any('MO ∥ SA ⇒ SA ∥ (OMK)' in str(m.get('content')) for messages in provider.inputs for m in messages)
    assert not any(m.get('tool_calls') for messages in provider.inputs for m in messages)  # no tool loop
    assert result['ocr']['steps'][0]['id'] == 's1'


async def test_text_transcript_stays_when_the_layout_fails(tmp_path):
    class NoLayout(RecordingMock):
        async def chat(self, messages, tools=None, **kwargs):
            if 'Разложи расшифровку' in messages[0]['content']:
                return {'role': 'assistant', 'content': '{"steps": []}'}
            return await super().chat(messages, tools, **kwargs)

    provider = NoLayout()
    provider.transcribe = AsyncMock(return_value='3^x > 9 ⇒ x > 2')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 16))
    assert result['is_graded'] and result['ocr'] == '3^x > 9 ⇒ x > 2' and 'statuses' not in result['analysis']


async def test_doubtful_place_is_settled_by_two_of_three_votes():
    from app.grading.structure import resolve_doubts
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=['≠', '>', '≠']))
    resolved = await resolve_doubts(provider, 'ОДЗ: 4 sin x [неразборчиво: > | ≠] 0', [png()])
    assert resolved == 'ОДЗ: 4 sin x ≠ 0'
    assert '[неразборчиво' not in provider.transcribe.call_args.args[0] and '4 sin x … 0' in provider.transcribe.call_args.args[0]


def test_statuses_block_is_split_from_notes():
    from app.grading.structure import split_statuses
    ocr = {'steps': [{'id': 's1', 'type': 'odz', 'title': 'ОДЗ', 'lines': ['x > 0'], 'figure': None},
                     {'id': 's2', 'type': 'answer', 'title': 'Ответ', 'lines': ['x > 1'], 'figure': None}]}
    statuses, notes, errors = split_statuses('ШАГИ:\ns1: ok\ns2: error — потеряна точка\n\nРазбор по шагам.', ocr)
    assert errors == [] and statuses[1] == {'id': 's2', 'status': 'error', 'note': 'потеряна точка'}
    assert notes == 'Разбор по шагам.'
    assert split_statuses('Разбор без шагов.', ocr)[0] is None


def test_response_format_names_the_task_maximum():
    from app.grading.package import load_package, response_format
    text = load_package(19)['response-format.md']
    assert response_format(text, 2) == text
    scaled = response_format(text, 4)
    assert 'для этого пакета 4' in scaled and 'Целое 0, 1, 2, 3 или 4' in scaled
    assert 'для этого пакета 2' not in scaled and '0, 1 или 2' not in scaled


async def test_tool_loop_response_stays_when_the_screen_step_fails(tmp_path):
    class BrokenScreen(RecordingMock):
        async def chat(self, messages, tools=None, **kwargs):
            if 'Перенеси их на шаги' in messages[0]['content']:
                self.inputs.append(messages)
                return {'role': 'assistant', 'content': '{"statuses": "нет"}'}
            return await super().chat(messages, tools, **kwargs)

    provider = BrokenScreen()
    result = json.loads(await service(tmp_path, provider).run(
        SafeImage(b'task'), [SafeImage(b'student')], 'test-user', 18))
    assert result['is_graded'] and type(result['ocr']) is str and 'statuses' not in result['analysis']
    assert sum('Перенеси их на шаги' in m[0]['content'] for m in provider.inputs) == 3  # two repairs, then the original


async def test_analysis_that_ran_out_of_reasoning_is_tried_once_more(tmp_path):
    from app.core.errors import LLMResponseFormatError

    class LoopsOnce(RecordingMock):
        looped = False

        async def chat(self, messages, tools=None, **kwargs):
            if 'составь notes.md' in messages[0]['content'] and not self.looped:
                self.looped = True
                raise LLMResponseFormatError('Модель не завершила ответ. Повтори проверку')
            return await super().chat(messages, tools, **kwargs)

    provider = LoopsOnce()
    provider.transcribe = AsyncMock(return_value='x = π + πn, n ∈ Z')
    result = json.loads(await service(tmp_path, provider).run(png(), [png()], 'test-user', 14))
    assert result['is_graded'] and provider.looped
    assert any('не уложилась в предел рассуждения' in m[0]['content'] for m in provider.inputs)
