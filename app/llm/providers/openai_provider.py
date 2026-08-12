"""OpenAI (and any OpenAI-compatible gateway) backend.

Set `LLM_BASE_URL` to point at a compatible endpoint -- Azure-style gateways,
self-hosted vLLM, OpenRouter, a corporate proxy.  Capability differences
between such endpoints are handled one level up in `LLMClient`.
"""

from __future__ import annotations

import logging
from typing import Any

import openai
from openai import AsyncOpenAI

from app.config import LLMSettings
from app.core.errors import (
    LLMBadRequestError,
    LLMConfigError,
    LLMError,
    LLMRateLimitError,
    LLMTimeoutError,
)
from app.llm.types import ChatRequest, ChatResponse, Usage

logger = logging.getLogger(__name__)


class OpenAIProvider:
    name = "openai"

    def __init__(self, settings: LLMSettings) -> None:
        if not settings.api_key:
            raise LLMConfigError(
                "LLM_API_KEY is not set. Set it, or run with LLM_PROVIDER=mock "
                "to work without a real model."
            )
        self._client = AsyncOpenAI(
            api_key=settings.api_key,
            base_url=settings.base_url or None,
            timeout=settings.timeout_s,
            # Retries are ours: the SDK's would hide attempt counts and would
            # not know how to step down structured-output mode.
            max_retries=0,
        )

    async def chat(self, request: ChatRequest) -> ChatResponse:
        kwargs: dict[str, Any] = {
            "model": request.model,
            # model_dump handles both plain strings and multimodal part lists;
            # the wire shape is identical to what the API expects.
            "messages": [m.model_dump(exclude_none=True) for m in request.messages],
        }
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.max_output_tokens is not None:
            kwargs[request.token_param] = request.max_output_tokens
        if request.response_format is not None:
            kwargs["response_format"] = request.response_format
        if request.seed is not None:
            kwargs["seed"] = request.seed
        if request.timeout_s is not None:
            kwargs["timeout"] = request.timeout_s
        if request.extra_body:
            # Passed through untouched. The SDK forwards unknown keys in the
            # body, which is how provider-specific switches (DeepSeek's
            # `thinking`, for one) reach an OpenAI-shaped endpoint.
            kwargs["extra_body"] = dict(request.extra_body)

        try:
            completion = await self._client.chat.completions.create(**kwargs)
        except openai.APITimeoutError as exc:
            raise LLMTimeoutError(f"model call timed out: {exc}") from exc
        except openai.RateLimitError as exc:
            raise LLMRateLimitError(f"rate limited by provider: {exc}") from exc
        except openai.BadRequestError as exc:
            raise LLMBadRequestError(
                str(exc), param=_offending_param(exc), details={"status": exc.status_code}
            ) from exc
        except openai.APIStatusError as exc:
            # 4xx other than 429 is a verdict about the account or the request
            # — no balance, revoked key, unknown model. Backing off changes
            # nothing, so surface it immediately.
            permanent = 400 <= exc.status_code < 500 and exc.status_code != 429
            raise LLMError(
                f"provider returned {exc.status_code}: {exc}",
                details={"status": exc.status_code},
                retryable=not permanent,
            ) from exc
        except openai.APIConnectionError as exc:
            raise LLMError(f"cannot reach provider: {exc}") from exc

        if not completion.choices:
            raise LLMError("provider returned no choices")

        choice = completion.choices[0]
        return ChatResponse(
            text=_message_text(choice.message, choice.finish_reason, request.max_output_tokens),
            model=completion.model or request.model,
            usage=_usage(completion.usage),
            finish_reason=choice.finish_reason,
            provider=self.name,
            raw_id=completion.id,
        )

    async def aclose(self) -> None:
        await self._client.close()


def _reasoning_text(message: Any) -> str:
    """Chain-of-thought, under whichever field name this provider uses."""
    for field in ("reasoning", "reasoning_content"):
        value = getattr(message, field, None)
        if value:
            return str(value)
    # The SDK parks unmodelled fields here rather than dropping them.
    extra = getattr(message, "model_extra", None) or {}
    for field in ("reasoning", "reasoning_content"):
        if extra.get(field):
            return str(extra[field])
    return ""


def _message_text(message: Any, finish_reason: str | None, budget: int | None = None) -> str:
    """The answer, wherever this model decided to put it.

    Two different provider behaviours collide here, and telling them apart
    matters because the wrong guess silently feeds chain-of-thought to the
    JSON parser as if it were the answer:

    * Some gateways return `content: null` and put the *answer* in a
      non-standard `reasoning` field (nvidia/nemotron-*, openai/gpt-oss-* via
      OpenRouter). Reading only `content` throws away a perfectly good
      response and burns the retry ladder on it.
    * True reasoning models (DeepSeek v4) use `reasoning_content` for
      thinking and `content` for the answer. Their reasoning tokens are
      drawn from the same `max_tokens` budget, so too small a budget ends the
      call with `finish_reason="length"`, mid-thought, `content` still empty.

    The discriminator is `finish_reason`. A truncated call has no answer to
    find, so falling back would hand the caller raw thinking. Report the real
    cause instead — the fix is a bigger budget, and nothing else will do.
    """
    content = getattr(message, "content", None)
    if content:
        return content

    if finish_reason == "length":
        reasoning = _reasoning_text(message)
        # Name the budget that was actually sent, not a settings variable. The
        # two stage profiles have different budgets (`LLM_MAX_OUTPUT_TOKENS`
        # and `LLM_VISION_MAX_OUTPUT_TOKENS`), and a message that always named
        # the first one sent people to raise a limit that was not the one hit.
        raise LLMError(
            "model exhausted its token budget while reasoning and never produced "
            "an answer"
            + (f"; this call was capped at {budget} output tokens" if budget else "")
            + " — raise the budget for the stage that failed "
            "(LLM_MAX_OUTPUT_TOKENS for the text stages, "
            "LLM_VISION_MAX_OUTPUT_TOKENS for any call carrying an image)"
            + (f" (reasoning began: {reasoning[:120]!r})" if reasoning else ""),
            # Deterministic, not transient: the same prompt under the same
            # budget truncates again. Retrying burns the wall clock and the
            # token bill to reach the identical failure — observed as four
            # attempts and 341s before this was pinned down.
            retryable=False,
            details={"finish_reason": finish_reason},
        )

    return _reasoning_text(message)


def _sub(raw: Any, container: str, field: str) -> int:
    """One nested usage counter, whether the SDK modelled it or not."""
    holder = getattr(raw, container, None)
    if holder is None and isinstance(getattr(raw, "model_extra", None), dict):
        holder = raw.model_extra.get(container)
    if holder is None:
        return 0
    value = getattr(holder, field, None)
    if value is None and isinstance(holder, dict):
        value = holder.get(field)
    return int(value or 0)


def _usage(raw: Any) -> Usage:
    if raw is None:
        return Usage()

    extra = getattr(raw, "model_extra", None) or {}
    # Vendors disagree on where the cache counter lives: DeepSeek reports both
    # `prompt_tokens_details.cached_tokens` and a flat `prompt_cache_hit_tokens`,
    # OpenAI only the nested one. Take whichever is present.
    cached = _sub(raw, "prompt_tokens_details", "cached_tokens") or int(
        extra.get("prompt_cache_hit_tokens") or 0
    )
    cost = extra.get("cost")

    return Usage(
        prompt_tokens=getattr(raw, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(raw, "completion_tokens", 0) or 0,
        total_tokens=getattr(raw, "total_tokens", 0) or 0,
        cached_prompt_tokens=cached,
        reasoning_tokens=_sub(raw, "completion_tokens_details", "reasoning_tokens"),
        provider_cost_usd=float(cost) if isinstance(cost, int | float) else None,
    )


def _offending_param(exc: openai.BadRequestError) -> str | None:
    """Best-effort extraction of which parameter the provider disliked."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("param"), str):
            return error["param"]

    # Compatible gateways are inconsistent about `param`; fall back to the text.
    text = str(exc).lower()
    for candidate in (
        "response_format",
        "json_schema",
        "max_completion_tokens",
        "max_tokens",
        "temperature",
        "seed",
    ):
        if candidate in text:
            return candidate
    return None
