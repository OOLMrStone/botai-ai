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
