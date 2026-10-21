"""Uncertain OCR is recovered from pixels by consensus, never by a lone suggestion."""
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

from PIL import Image
import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading.images import SafeImage
from app.grading.structure import resolve_doubts


def photo():
    output = BytesIO()
    Image.new('RGB', (40, 30), 'white').save(output, 'PNG')
    return SafeImage(output.getvalue(), 'image/png')


def vote(value):
    return json.dumps({'reading': value}, ensure_ascii=False)


async def resolve(text, answers):
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=answers))
    value = await resolve_doubts(provider, text, [photo()], fail_on_transport=True,
                                 recover_missing_options=True)
    return value, provider


@pytest.mark.parametrize('marker', ['[неразборчиво: >]', '[неразборчиво: > | >]',
    '[неразборчиво: …]', '[неразборчиво]', '[неразборчиво: ]', '[Неразборчиво: ?]'])
async def test_missing_alternatives_require_independent_visual_consensus(marker):
    value, provider = await resolve('x ' + marker + ' 0', [vote('≠'), vote(None), vote('≠')])
    assert value == 'x ≠ 0'
    assert provider.transcribe.await_count == 3
    for call in provider.transcribe.call_args_list:
        assert call.args[1]['type'] == 'image_url'
        assert marker not in call.args[0]  # A lone suggestion must not prime the reread.


@pytest.mark.parametrize('answers', [
    [vote('>'), vote('≠'), vote(None)],
    [vote(None)] * 3,
    ['>', '>', '>'],
    [vote('[неразборчиво: >]')] * 3,
    ['{"reading":">","reading":"≠"}'] * 3,
    [vote('x\n>0')] * 3,
    [vote('x\u2028>0')] * 3,
    [vote('x\u2029>0')] * 3,
    [vote('x' * 501)] * 3,
    ['{"reading":"\\ud800"}'] * 3,
])
async def test_invalid_or_unsettled_rereads_never_release_single_candidate(answers):
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=answers))
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, 'x [неразборчиво: >] 0', [photo()],
                             fail_on_transport=True, recover_missing_options=True)
    assert provider.transcribe.await_count == 3


async def test_transport_failure_never_spends_another_reread():
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=LLMError('uncertain dispatch')))
    with pytest.raises(LLMError):
        await resolve_doubts(provider, 'x [неразборчиво: >] 0', [photo()],
                             fail_on_transport=True, recover_missing_options=True)
    assert provider.transcribe.await_count == 1


async def test_valid_alternatives_keep_existing_exact_vote_contract():
    value, provider = await resolve('x [неразборчиво: > | ≠] 0', ['≠', '>', '≠'])
    assert value == 'x ≠ 0' and provider.transcribe.await_count == 3


@pytest.mark.parametrize('text', ['x [неразборчиво: >',
    'x [неразборчиво: > | ≠] 0\ny [неразборчиво:',
    '\n'.join(['x [неразборчиво] 0'] * 7)])
async def test_malformed_or_excess_markers_fail_before_spending_calls(text):
    provider = SimpleNamespace(transcribe=AsyncMock())
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, text, [photo()], fail_on_transport=True,
                             recover_missing_options=True)
    provider.transcribe.assert_not_awaited()


async def test_duplicate_markers_are_replaced_at_their_original_positions():
    value, _ = await resolve('x [неразборчиво] 0\ny [неразборчиво] 0',
                            [vote('>')] * 3 + [vote('≠')] * 3)
    assert value == 'x > 0\ny ≠ 0'


async def test_legacy_behavior_does_not_start_new_rereads():
    provider = SimpleNamespace(transcribe=AsyncMock())
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, 'x [неразборчиво: >] 0', [photo()])
    provider.transcribe.assert_not_awaited()


async def resolve_with_retries(text, answers):
    from uuid import uuid4
    from app.grading.observability import RunStore

    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=answers))
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    value = await resolve_doubts(provider, text, [photo()], fail_on_transport=True,
                                 recover_missing_options=True, retry_steps=True, trace=trace)
    return value, provider, trace


async def test_fragment_retry_keeps_previous_consensus_and_votes_independent():
    value, provider, trace = await resolve_with_retries(
        'x [неразборчиво] 0\ny [неразборчиво] 0',
        [vote('>')] * 3 + [vote('<'), vote('≠'), vote(None)] + [vote('≠')] * 3)
    assert value == 'x > 0\ny ≠ 0'
    assert provider.transcribe.await_count == 9
    assert all('"line": "x ' in call.args[0] for call in provider.transcribe.call_args_list[:3])
    assert all('"line": "y ' in call.args[0] for call in provider.transcribe.call_args_list[3:])
    retries = [e for e in trace.store.events(trace.run_id)['items'] if e['type'] == 'retry']
    assert len(retries) == 1
    assert retries[0]['data']['step'] == 'ocr.doubt.2'
    assert retries[0]['data']['attempt'] == 2


async def test_fragment_retry_stops_after_four_consensus_batches():
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=[vote(None)] * 12))
    with pytest.raises(LLMResponseFormatError):
        await resolve_doubts(provider, 'x [неразборчиво] 0', [photo()],
                             recover_missing_options=True, retry_steps=True)
    assert provider.transcribe.await_count == 12


async def test_fragment_transport_failure_retries_batch_without_counting_failed_vote():
    value, provider, _ = await resolve_with_retries('x [неразборчиво] 0',
        [LLMError('temporary connection failure'), vote('>'), vote('>'), vote('>')])
    assert value == 'x > 0'
    assert provider.transcribe.await_count == 4


async def test_fragment_configuration_error_does_not_spend_more_votes():
    from app.core.errors import LLMConfigError

    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=LLMConfigError('configuration failure')))
    with pytest.raises(LLMConfigError):
        await resolve_doubts(provider, 'x [неразборчиво] 0', [photo()],
                             recover_missing_options=True, retry_steps=True)
    assert provider.transcribe.await_count == 1


async def test_fragment_notation_failure_is_retried_with_precise_issue_code():
    value, provider, trace = await resolve_with_retries('x = [неразборчиво]',
        [vote('t²')] * 3 + [vote('$t^{2}$')] * 3)
    assert value == 'x = $t^{2}$'
    assert provider.transcribe.await_count == 6
    failures = [e for e in trace.store.events(trace.run_id)['items'] if e['type'] == 'validation_failed']
    assert len(failures) == 1
    assert 'unicode_math_script' in failures[0]['data']['issue_codes']


async def test_fragment_programming_failure_is_not_disguised_as_no_consensus():
    provider = SimpleNamespace(transcribe=AsyncMock(side_effect=RuntimeError('local programming failure')))
    with pytest.raises(RuntimeError):
        await resolve_doubts(provider, 'x [неразборчиво] 0', [photo()],
                             recover_missing_options=True, retry_steps=True)
    assert provider.transcribe.await_count == 1
