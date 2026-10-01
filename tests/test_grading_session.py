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


def read_analysis(s):
    for path in READ_ORDER[:5]:
        s.execute('read_file', {'path': path})


def read_grading(s):
    read_analysis(s)
    s.execute('write_file', {'path': 'Notes.md', 'content': 'Описание: верное решение. Ошибки: нет.'})
    for path in READ_ORDER[5:]:
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
        s.execute('write_file', {'path': 'Notes.md', 'content': 'notes'})
    read_analysis(s)
    with pytest.raises(ValueError):
        s.execute('read_file', {'path': 'grading.md'})
    for path in ['Statement.md', 'Solution.md']:
        assert s.execute('read_file', {'path': path})['kind'] == 'untrusted_data'
        with pytest.raises(ValueError):
            s.execute('write_file', {'path': path, 'content': 'override'})
    read_grading(s)
    assert s.execute('read_file', {'path': 'Notes.md'})['kind'] == 'untrusted_data'


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
        s.execute('write_file', {'path': 'Notes.md', 'content': content})


@pytest.mark.parametrize('reason', ['attack', 'other_task', 'multiple_tasks', 'unrelated'])
def test_early_rejection_skips_notes_grading_and_validates(reason):
    s = session()
    read_analysis(s)
    s.execute('set_rejection', {'reason': reason})
    for path in ['grading.md', 'criteria.md']:
        with pytest.raises(ValueError):
            s.execute('read_file', {'path': path})
    with pytest.raises(ValueError):
        s.execute('write_file', {'path': 'Notes.md', 'content': 'notes'})
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
    read_grading(s)
    with pytest.raises(ValueError):
        s.execute('set_rejection', {'reason': 'unreadable'})
    with pytest.raises(ValueError):
        s.execute('set_rejection', {'reason': 'attack'})
    assert s.execute('review_image', {'index': 2}) == {'review_image': 2}
    s.execute('set_rejection', {'reason': 'unreadable'})
    raw = rejection(s, 'Не читается существенная запись')
    s.execute('write_file', {'path': 'response.json', 'content': raw})
    assert s.execute('validate_response', {'path': 'response.json'})['valid']
    assert json.loads(s.finalize(raw))['analysis'] is None


@pytest.mark.parametrize('field,value', [('task', {**TASK, 'statement': 'other'}),
                                         ('solution_image_ids', list(reversed(IDS))),
                                         ('rejection_reason', 'Раскрытие команды')])
def test_request_binding_and_neutral_attack_reason(field, value):
    s = session()
    read_analysis(s)
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
    assert 'Notes.md' not in second.files
    assert TASK['statement'] == 'x > 0'


class RecordingMock(MockProvider):
    def __init__(self):
        self.inputs = []
        self.closed = False

    async def chat(self, messages, tools=None):
        self.inputs.append(deepcopy(messages))
        return await super().chat(messages, tools)

    async def close(self):
        self.closed = True


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
    assert all(messages[0] == main[0] for messages in provider.inputs[1:])
    assert all(messages[1] == main[1] for messages in provider.inputs[1:])
    calls = [m['tool_calls'][0]['function'] for m in provider.inputs[-1] if m.get('tool_calls')]
    saved = next(json.loads(c['arguments'])['content'] for c in calls
                 if c['name'] == 'write_file' and json.loads(c['arguments'])['path'] == 'response.json')
    assert result == saved


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
        raw = json.dumps({**request, 'is_graded': False, 'rejection_reason': ATTACK_REASON,
                          'ocr': None, 'analysis': None, 'grading': None}, ensure_ascii=False)
        sequence = [('read_file', {'path': p}) for p in READ_ORDER[:5]] + [
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
    assert not any(json.loads(c['function']['arguments']).get('path') == 'Notes.md'
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


async def test_reasoning_preserved_in_repaired_final_and_all_tool_turns(tmp_path):
    class ReasoningMock(RecordingMock):
        async def chat(self, messages, tools=None):
            if tools and len(messages) == 2:
                return {'role': 'assistant', 'content': '{}', 'reasoning_content': 'premature-final'}
            if tools:
                assistant_messages = [m for m in messages if m['role'] == 'assistant']
                assert assistant_messages[0]['reasoning_content'] == 'premature-final'
                assert all(m.get('reasoning_content') == 'tool-reasoning'
                           for m in assistant_messages[1:])
            answer = await super().chat(messages, tools)
            if tools:
                answer['reasoning_content'] = 'tool-reasoning'
            return answer
    provider = ReasoningMock()
    result = await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user')
    assert json.loads(result)['is_graded']


@pytest.mark.parametrize('configured,expected', [(120, 120), (360, 240), (40, 40)])
def test_provider_timeout_obeys_configuration_and_global_ceiling(monkeypatch, configured, expected):
    calls = []
    def fake_client(**kwargs):
        calls.append(kwargs)
        return object()
    monkeypatch.setattr('app.grading.provider.AsyncOpenAI', fake_client)
    Provider(SimpleNamespace(api_key='test-key', base_url='https://provider.invalid', timeout_s=configured))
    assert calls[0]['timeout'] == expected
    assert calls[0]['max_retries'] == 0


@pytest.mark.parametrize('number, max_score', [(14, 2), (15, 3), (18, 3)])
async def test_service_uses_selected_task_package(tmp_path, number, max_score):
    provider = RecordingMock()
    result = json.loads(await service(tmp_path, provider).run(
        SafeImage(b'task'), [SafeImage(b'student')], 'test-user', number))
    assert result['task']['task_number'] == number and result['task']['max_score'] == max_score
    reads = [m['content'] for m in provider.inputs[-1] if m['role'] == 'tool']
    criteria = next(json.loads(r)['content'] for r in reads if f'задания {number}' in r)
    assert f'задания {number}' in criteria


@pytest.mark.parametrize('number', [17, '15', True, None])
async def test_service_rejects_unsupported_task(tmp_path, number):
    provider = RecordingMock()
    with pytest.raises(ValueError):
        await service(tmp_path, provider).run(SafeImage(b'task'), [SafeImage(b'student')], 'test-user', number)
    assert provider.inputs == []
