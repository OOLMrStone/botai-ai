"""Reasoning models: where the answer lives, and what an empty one means.

Two provider behaviours look identical on the wire — `content` is empty — and
must be handled in opposite ways. Getting it wrong either throws away a good
response or feeds raw chain-of-thought to the JSON parser as if it were the
answer. Both were observed in practice; see `_message_text`.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import LLMSettings, VisionOverrides
from app.core.errors import LLMError
from app.llm.providers.openai_provider import _message_text


def message(content=None, **extra):
    """A choice message shaped like the SDK's, including unmodelled fields."""
    return SimpleNamespace(content=content, model_extra=extra or {}, **extra)


# -- where the answer lives ------------------------------------------------
def test_content_wins_when_present():
    msg = message(content='{"ok":true}', reasoning="thinking out loud")
    assert _message_text(msg, "stop") == '{"ok":true}'


@pytest.mark.parametrize("field", ["reasoning", "reasoning_content"])
def test_answer_recovered_from_reasoning_field_when_content_empty(field):
    """nemotron-*/gpt-oss-* via OpenRouter put the answer here, not in content."""
    msg = message(content=None, **{field: '{"ok":true}'})
    assert _message_text(msg, "stop") == '{"ok":true}'


def test_empty_content_and_no_reasoning_is_empty_string():
    assert _message_text(message(content=None), "stop") == ""


# -- truncation is not a missing answer ------------------------------------
def test_truncated_reasoning_raises_instead_of_returning_thoughts():
    """DeepSeek v4 spends max_tokens on reasoning; `content` is then empty.

    Falling back would hand the caller chain-of-thought as the answer.
    """
    msg = message(content=None, reasoning_content="We need answer in JSON. Need eval")
    with pytest.raises(LLMError) as excinfo:
        _message_text(msg, "length")
    assert "LLM_MAX_OUTPUT_TOKENS" in str(excinfo.value)


def test_truncation_names_the_budget_that_was_actually_sent():
    """Two stage profiles have two budgets, and the message used to name one.

    A stage-2 call that borrows the vision endpoint is capped by
    LLM_VISION_MAX_OUTPUT_TOKENS; being told to raise LLM_MAX_OUTPUT_TOKENS
    sends you to change a number that was never the one hit.
    """
    msg = message(content=None, reasoning_content="thinking")
    with pytest.raises(LLMError) as excinfo:
        _message_text(msg, "length", 8000)
    text = str(excinfo.value)
    assert "8000" in text
    assert "LLM_VISION_MAX_OUTPUT_TOKENS" in text


def test_truncation_is_not_retryable():
    """Same prompt, same budget, same truncation — retrying only burns money.

    Regression: this cost four attempts and 341s before it was pinned down.
    """
    msg = message(content=None, reasoning_content="thinking")
    with pytest.raises(LLMError) as excinfo:
        _message_text(msg, "length")
    assert excinfo.value.retryable is False


def test_finish_length_with_content_is_fine():
    """Truncated *answer* still parses or fails downstream on its own terms."""
    assert _message_text(message(content='{"partial"'), "length") == '{"partial"'


# -- extra_body plumbing ---------------------------------------------------
def test_extra_body_parses_json_from_env():
    settings = LLMSettings(extra_body='{"thinking":{"type":"disabled"}}')
    assert settings.extra_body == {"thinking": {"type": "disabled"}}


def test_extra_body_blank_is_unset():
    assert LLMSettings(extra_body="").extra_body is None
    assert VisionOverrides(extra_body="").extra_body is None


def test_extra_body_rejects_non_object():
    with pytest.raises(ValueError):
        LLMSettings(extra_body="[1,2,3]")
    with pytest.raises(ValueError):
        LLMSettings(extra_body="not json")


def test_vision_overrides_apply_over_text_settings():
    """Stage 1 turns thinking off; the text stages must keep it on."""
    from app.config import AppSettings, DebugSettings, GradingSettings, Settings

    settings = Settings(
        app=AppSettings(),
        grading=GradingSettings(),
        debug=DebugSettings(),
        llm=LLMSettings(model="deepseek-v4-flash", max_output_tokens=32000),
        vision=VisionOverrides(
            model="deepseek-v4-flash-vision-exp",
            max_output_tokens=8000,
            extra_body='{"thinking":{"type":"disabled"}}',
        ),
    )
    assert settings.vision_llm.model == "deepseek-v4-flash-vision-exp"
    assert settings.vision_llm.max_output_tokens == 8000
    assert settings.vision_llm.extra_body == {"thinking": {"type": "disabled"}}
    # the text client is untouched
    assert settings.llm.extra_body is None
    assert settings.llm.max_output_tokens == 32000
