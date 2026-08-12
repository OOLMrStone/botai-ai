"""LLMClient behaviour: retries, capability fallback, structured-output ladder."""

from __future__ import annotations

import pytest

from app.config import LLMSettings
from app.core.errors import LLMBadRequestError, LLMError, LLMResponseFormatError
from app.domain.schemas import LLMVerdict
from app.llm.client import LLMClient
from app.llm.providers import MockProvider
from app.llm.recorder import TraceRecorder
from app.llm.schema import extract_json, to_strict_schema
from app.llm.types import Message

MESSAGES = [Message.system("ты эксперт"), Message.user("проверь решение")]


def make_client(**overrides) -> tuple[LLMClient, MockProvider]:
    defaults = {"provider": "mock", "model": "mock-model", "max_retries": 2}
    settings = LLMSettings(**(defaults | overrides))
    provider = MockProvider()
    return LLMClient(settings, provider, TraceRecorder(limit=32)), provider


# -- structured output ------------------------------------------------------
async def test_structured_output_validates_into_schema():
    client, _ = make_client()
    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert isinstance(result.value, LLMVerdict)
    assert result.meta.structured_mode == "json_schema"
    assert result.meta.mocked is True
    assert result.meta.usage.total_tokens > 0


async def test_structured_output_is_deterministic_for_same_prompt():
    client, _ = make_client()
    first = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)
    second = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)
    assert first.value == second.value


async def test_mock_score_marker_pins_the_score():
    client, _ = make_client()
    result = await client.complete_structured(
        messages=[Message.user("проверь [[MOCK_SCORE=3]]")], schema=LLMVerdict
    )
    assert result.value.score == 3


# -- retries ----------------------------------------------------------------
async def test_transient_failure_is_retried():
    client, provider = make_client()
    provider.push_error("rate_limit", "429")

    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert result.meta.attempts >= 2
    assert any("transient" in note for note in result.meta.notes)


async def test_non_retryable_errors_fail_fast():
    """A 402/403 is a verdict, not a hiccup: one attempt, no backoff."""
    client, provider = make_client(max_retries=3)
    provider.push_exception(
        LLMError("provider returned 402: Insufficient Balance", retryable=False)
    )
    with pytest.raises(LLMError, match="402"):
        await client.complete(messages=MESSAGES)
    assert len(provider.calls) == 1


async def test_retries_are_bounded():
    client, provider = make_client(max_retries=1)
    for _ in range(5):
        provider.push_error("timeout", "boom")

    with pytest.raises(LLMError):
        await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)


# -- capability probing -----------------------------------------------------
async def test_rejected_temperature_is_dropped_and_remembered():
    client, provider = make_client()
    assert client.caps.allow_temperature is True
    provider.push_exception(
        LLMBadRequestError("unsupported value: temperature", param="temperature")
    )

    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert client.caps.allow_temperature is False
    assert any("temperature" in note for note in result.meta.notes)
    # The lesson sticks: the next call never sends it.
    await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)
    assert provider.calls[-1].temperature is None


async def test_rejected_token_parameter_flips():
    client, provider = make_client()
    provider.push_exception(
        LLMBadRequestError("use max_completion_tokens", param="max_tokens")
    )

    await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert client.caps.token_param == "max_completion_tokens"
    assert provider.calls[-1].token_param == "max_completion_tokens"


async def test_per_call_extra_body_is_merged_over_the_settings():
    client, provider = make_client()
    client.settings.extra_body = {"thinking": {"type": "disabled"}, "vendor": 1}

    await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": {"type": "enabled"}}
    )

    # the call wins on its own key, the deployment's other keys survive
    assert provider.calls[-1].extra_body == {"thinking": {"type": "enabled"}, "vendor": 1}


async def test_a_none_in_the_per_call_extra_body_deletes_the_settings_key():
    """The only way to say "send nothing here" — see RFC 7396 merge-patch.

    Overriding is not enough: the *absence* of `thinking` means the provider
    default, and no value can spell that.
    """
    client, provider = make_client()
    client.settings.extra_body = {"thinking": {"type": "disabled"}, "keep": 1}

    await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": None}
    )

    assert provider.calls[-1].extra_body == {"keep": 1}


async def test_deleting_the_last_key_sends_no_extra_body_at_all():
    client, provider = make_client()
    client.settings.extra_body = {"thinking": {"type": "disabled"}}

    await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": None}
    )

    assert provider.calls[-1].extra_body is None


async def test_rejected_extra_body_is_dropped_rather_than_sinking_the_call():
    """A toggle that spells a vendor parameter wrong costs a note, not a grade."""
    client, provider = make_client()
    provider.push_exception(LLMBadRequestError("unknown parameter", param="thinking"))

    result = await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": {"type": "enabled"}}
    )

    assert provider.calls[-1].extra_body is None
    assert any("extra body" in note for note in result.meta.notes)
    assert any("NOT the configuration you asked for" in note for note in result.meta.notes)


async def test_dropping_the_extra_body_is_not_remembered_for_later_calls():
    """Unlike temperature: it is per-call and deliberate, so it must be retried.

    Remembering it would make a later benchmark report a switch it never sent.
    """
    client, provider = make_client()
    provider.push_exception(LLMBadRequestError("unknown parameter", param="thinking"))
    await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": {"type": "enabled"}}
    )

    await client.complete_structured(
        messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": {"type": "enabled"}}
    )
    assert provider.calls[-1].extra_body == {"thinking": {"type": "enabled"}}


async def test_an_unrelated_bad_parameter_still_raises():
    """The drop must be scoped to what we injected, not a blanket retry."""
    client, provider = make_client()
    provider.push_exception(LLMBadRequestError("nope", param="messages"))

    with pytest.raises(LLMBadRequestError):
        await client.complete_structured(
            messages=MESSAGES, schema=LLMVerdict, extra_body={"thinking": {"type": "enabled"}}
        )


async def test_gpt5_style_model_starts_without_temperature():
    client, _ = make_client(model="gpt-5-mini")
    assert client.caps.allow_temperature is False
    assert client.caps.token_param == "max_completion_tokens"


# -- structured-output ladder ----------------------------------------------
async def test_unsupported_response_format_steps_down_the_ladder():
    client, provider = make_client()
    provider.push_exception(
        LLMBadRequestError("response_format not supported", param="response_format")
    )

    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert result.meta.structured_mode == "json_object"
    assert client.caps.structured_mode == "json_object"


async def test_pinned_mode_does_not_step_down():
    client, provider = make_client(structured_mode="json_schema")
    provider.push_exception(
        LLMBadRequestError("response_format not supported", param="response_format")
    )

    with pytest.raises(LLMBadRequestError):
        await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)


async def test_malformed_json_triggers_one_repair_round():
    client, provider = make_client()
    provider.push_text("это не json, извини")

    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    assert isinstance(result.value, LLMVerdict)
    assert any("repair" in note for note in result.meta.notes)


async def test_unparseable_output_eventually_raises():
    client, provider = make_client(structured_mode="prompt")
    for _ in range(4):
        provider.push_text("никакого json тут нет")

    with pytest.raises(LLMResponseFormatError):
        await client.complete_structured(messages=MESSAGES, schema=LLMVerdict, repair_attempts=1)


# -- tracing ----------------------------------------------------------------
async def test_calls_land_in_the_trace_buffer():
    client, _ = make_client()
    result = await client.complete_structured(messages=MESSAGES, schema=LLMVerdict)

    trace = client.recorder.get(result.meta.trace_id)
    assert trace is not None
    assert trace.parsed is not None
    assert trace.messages[0].content == "ты эксперт"


async def test_free_form_completion_returns_text():
    client, provider = make_client()
    provider.push_text("привет")
    result = await client.complete(messages=[Message.user("hi")])
    assert result.text == "привет"


# -- schema helpers ---------------------------------------------------------
def test_strict_schema_is_closed_and_fully_required():
    schema = to_strict_schema(LLMVerdict)

    def check(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            assert "default" not in node
            for value in node.values():
                check(value)
        elif isinstance(node, list):
            for item in node:
                check(item)

    check(schema)


@pytest.mark.parametrize(
    "raw",
    [
        '{"a": 1}',
        '```json\n{"a": 1}\n```',
        'Вот результат:\n{"a": 1}\nНадеюсь, помог.',
        '{"a": "фигурная } скобка в строке"}',
    ],
)
def test_extract_json_handles_wrapped_output(raw):
    assert "a" in extract_json(raw)


def test_extract_json_rejects_garbage():
    with pytest.raises(ValueError):
        extract_json("тут нет объекта")
