"""Offline fault injection at model boundaries; invalid attempts never become grades."""
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

from PIL import Image
import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading.images import SafeImage
from app.grading.package import load_package, task_directory
from app.grading.provider import MockProvider
from app.grading.staged import MAX_REPAIRS, run_staged
from app.grading.structure import resolve_doubts, structure_reading


TASK = {'id': 'test-task', 'task_number': 16, 'max_score': 2,
        'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}
READING = 'x > 0\nОтвет: (0; +∞)'
GOOD = object()


class ScriptedGrader(MockProvider):
    def __init__(self, answers):
        self.answers = iter(answers)
        self.grading_calls = 0
        self.history = []

    async def chat(self, messages, tools=None, **kwargs):
        if 'Анализ завершён: notes.md' in messages[0]['content']:
            self.grading_calls += 1
            self.history.append(messages)
            answer = next(self.answers)
            if isinstance(answer, Exception):
                raise answer
            if answer is not GOOD:
                return answer
        return await super().chat(messages, tools, **kwargs)


async def run(provider, reading=READING):
    return await run_staged(provider, TASK, ['test-image'], load_package(16), reading,
                            AsyncMock(), task_directory(16) / 'popular_mistakes.md')


@pytest.mark.parametrize('invalid', [
    {'content': '{"analysis":'},
    {'content': '{"grading":{},"grading":{}}'},
    {'content': '[]'},
    {'content': None},
    {'content': 'x' * 128_001},
    {'content': '{"analysis":{},"grading":{}}', 'tool_calls': [{'id': 'unexpected'}]},
    LLMResponseFormatError('truncated'),
])
async def test_first_invalid_answer_is_repaired_with_the_same_budget(invalid):
    provider = ScriptedGrader([invalid, GOOD])
    result = json.loads(await run(provider))
    assert result['is_graded'] and result['grading']['score'] == 2
    assert provider.grading_calls == 2
    assert provider.history[-1][-1]['content'].startswith('Сервер не принял ответ')
    assert all('reasoning_content' not in m for history in provider.history for m in history)


async def test_permanently_invalid_json_stops_after_two_repairs():
    provider = ScriptedGrader([{'content': 'not JSON'}] * (MAX_REPAIRS + 1))
    with pytest.raises(LLMResponseFormatError):
        await run(provider)
    assert provider.grading_calls == MAX_REPAIRS + 1


async def test_invalid_recheck_cannot_release_the_old_full_score():
    provider = ScriptedGrader([GOOD] + [{'content': 'not JSON'}] * (MAX_REPAIRS + 1))
    with pytest.raises(LLMResponseFormatError):
        await run(provider, 'x > 1\nОтвет: (1; +∞)')
    assert provider.grading_calls == 2 + MAX_REPAIRS


async def test_repaired_first_grade_also_receives_the_answer_recheck():
    provider = ScriptedGrader([{'content': 'not JSON'}, GOOD, GOOD])
    await run(provider, 'x > 1\nОтвет: (1; +∞)')
    assert provider.grading_calls == 3
    assert provider.history[-1][-1]['content'].startswith('Сервер сравнил записи ответов')


async def test_recheck_after_repair_does_not_reset_the_repair_budget():
    provider = ScriptedGrader([{'content': 'not JSON'}, GOOD,
                              {'content': 'not JSON'}, {'content': 'still invalid'}])
    with pytest.raises(LLMResponseFormatError):
        await run(provider, 'x > 1\nОтвет: (1; +∞)')
    assert provider.grading_calls == 2 + MAX_REPAIRS


async def test_invalid_recheck_can_be_repaired_without_reviving_old_grade():
    response = await MockProvider().chat([
        {'role': 'system', 'content': 'Анализ завершён: notes.md'},
        {'role': 'user', 'content': ''},
    ])
    corrected = json.loads(response['content'])
    corrected['grading']['score'] = 1
    response['content'] = json.dumps(corrected, ensure_ascii=False)
    provider = ScriptedGrader([GOOD, {'content': 'not JSON'}, response])
    result = json.loads(await run(provider, 'x > 1\nОтвет: (1; +∞)'))
    assert result['grading']['score'] == 1
    assert provider.grading_calls == 3


async def test_transport_failure_is_not_a_json_retry():
    provider = ScriptedGrader([LLMError('provider unavailable')])
    with pytest.raises(LLMError):
        await run(provider)
    assert provider.grading_calls == 1


def photo():
    buffer = BytesIO()
    Image.new('RGB', (20, 20), 'white').save(buffer, 'PNG')
    return SafeImage(buffer.getvalue(), 'image/png')


@pytest.mark.parametrize('votes', [
    [LLMError('down')] * 3,
    ['>', '≠', 'не знаю'],
    ['не >, а ≠'] * 3,
])
async def test_no_ocr_consensus_never_selects_first_option(votes):
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=votes))
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, 'x [неразборчиво: > | ≠] 0', [photo()])
    assert provider.transcribe.await_count == 3


async def test_too_many_doubts_fail_before_spending_votes():
    provider = SimpleNamespace(transcribe=AsyncMock())
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, '\n'.join(['x [неразборчиво: > | ≠] 0'] * 7), [photo()])
    provider.transcribe.assert_not_awaited()


async def test_structure_rejects_duplicate_keys_and_uses_bounded_repairs():
    raw = ('{"steps":[{"id":"s1","type":"answer","title":"Ответ",'
           '"lines":["x > 0"],"figure":null}],"answer":null,"answer":"999"}')
    provider = SimpleNamespace(chat=AsyncMock(return_value={'content': raw}))
    assert await structure_reading(provider, 'x > 0', 16) is None
    assert provider.chat.await_count == 3
