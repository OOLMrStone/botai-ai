"""The wrapper everything else in the service talks to.

What it takes off the caller's hands:

* **Retries** with exponential backoff + jitter on timeouts, rate limits and
  5xx, with the attempt count reported back rather than hidden.
* **Capability probing.** Providers disagree about `max_tokens` vs
  `max_completion_tokens` and about whether a custom `temperature` is allowed.
  Rather than maintain a model table that goes stale, the client guesses, and
  when a provider rejects a parameter it drops it, retries, and *remembers* --
  so the cost is one 400 per process, not one per call.
* **Structured output negotiation.** Asks for a strict JSON schema, falls back
  to plain JSON mode, then to schema-in-the-prompt, depending on what the
  endpoint supports.  Malformed JSON gets one repair round before the ladder
  steps down.
* **Tracing.** Every call lands in the ring buffer behind `/debug/llm/traces`.
* **Concurrency capping** via a semaphore, so a batch request cannot open
  hundreds of sockets at once.

Typical use:

    client = get_llm_client()
    out = await client.complete_structured(messages=msgs, schema=LLMVerdict)
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any, Literal, TypeVar

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.config import DebugSettings, LLMSettings, get_settings
from app.core.context import get_request_id, new_id
from app.core.errors import (
    LLMBadRequestError,
    LLMConfigError,
    LLMError,
    LLMRateLimitError,
    LLMResponseFormatError,
    LLMTimeoutError,
)
from app.llm.providers import ChatProvider, MockProvider, OpenAIProvider
from app.llm.recorder import TraceRecord, TraceRecorder, get_recorder
from app.llm.schema import extract_json, schema_prompt_block, to_strict_schema
from app.llm.types import (
    CallMeta,
    ChatRequest,
    ChatResponse,
    LLMResult,
    Message,
    StructuredResult,
    Usage,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_STRUCTURED_LADDER = ("json_schema", "json_object", "prompt")
_FORMAT_PARAMS = frozenset({"response_format", "json_schema"})
_TOKEN_PARAMS = frozenset({"max_tokens", "max_completion_tokens"})

# Models that historically reject a custom temperature. Only a starting guess;
# a 400 overrides it either way.
_FIXED_TEMPERATURE_PREFIXES = ("gpt-5", "o1", "o3", "o4")


class _Capabilities:
    """What we currently believe this endpoint accepts. Learned, not declared."""

    __slots__ = ("token_param", "allow_temperature", "structured_mode")

    def __init__(self, settings: LLMSettings) -> None:
        model = settings.model.lower()
        fixed_temp = model.startswith(_FIXED_TEMPERATURE_PREFIXES)

        self.token_param: str = (
            "max_completion_tokens"
            if settings.token_param == "auto" and fixed_temp
            else ("max_tokens" if settings.token_param == "auto" else settings.token_param)
        )
        self.allow_temperature: bool = (
            not fixed_temp
            if settings.supports_temperature == "auto"
            else settings.supports_temperature == "true"
        )
        self.structured_mode: str = (
            "json_schema" if settings.structured_mode == "auto" else settings.structured_mode
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "token_param": self.token_param,
            "allow_temperature": self.allow_temperature,
            "structured_mode": self.structured_mode,
        }


class LLMClient:
    def __init__(
        self,
        settings: LLMSettings,
        provider: ChatProvider,
        recorder: TraceRecorder | None = None,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.recorder = recorder or get_recorder()
        self.caps = _Capabilities(settings)
        self._semaphore = asyncio.Semaphore(max(1, settings.concurrency))
        # `auto` may step down the ladder; an explicit setting is pinned.
        self._ladder_locked = settings.structured_mode != "auto"

    @property
    def model(self) -> str:
        return self.settings.model

    @property
    def provider_name(self) -> str:
        return self.provider.name

    # -- public API -------------------------------------------------------
    async def complete(
        self,
        *,
        messages: list[Message],
        model: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
        timeout_s: float | None = None,
        seed: int | None = None,
        response_format: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> LLMResult:
        """Free-form completion. Returns text plus accounting metadata."""
        trace_id = trace_id or new_id("llm")
        notes: list[str] = []
        started = time.perf_counter()

        request = self._build_request(
            messages=messages,
            model=model,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            timeout_s=timeout_s,
            seed=seed,
            response_format=response_format,
        )

        try:
            response, attempts = await self._execute(request, notes)
        except LLMError as exc:
            self._trace(trace_id, request, None, notes, started, 0, error=str(exc))
            raise

        meta = self._meta(trace_id, response, started, attempts, None, notes)
        self._trace(trace_id, request, response, notes, started, attempts)
        return LLMResult(text=response.text, meta=meta)

    async def complete_structured(
        self,
        *,
        messages: list[Message],
        schema: type[T],
        schema_name: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
        timeout_s: float | None = None,
        seed: int | None = None,
        repair_attempts: int = 1,
        trace_id: str | None = None,
        extra_body: dict[str, Any] | None = None,
    ) -> StructuredResult[T]:
        """Completion validated into `schema`.

        Walks the structured-output ladder and repairs malformed JSON before
        giving up, so callers can treat the result as trustworthy.
        """
        trace_id = trace_id or new_id("llm")
        schema_name = schema_name or schema.__name__
        json_schema = to_strict_schema(schema)
        notes: list[str] = []
        started = time.perf_counter()

        modes = self._mode_ladder()
        last_error: Exception | None = None
        total_attempts = 0

        for position, mode in enumerate(modes):
            is_last = position == len(modes) - 1
            request = self._build_request(
                messages=self._messages_for_mode(messages, mode, json_schema),
                model=model,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                timeout_s=timeout_s,
                seed=seed,
                response_format=_response_format(mode, schema_name, json_schema),
                extra_body=extra_body,
            )

            try:
                response, attempts = await self._execute(request, notes)
                total_attempts += attempts
            except LLMBadRequestError as exc:
                total_attempts += 1
                last_error = exc
                if exc.param in _FORMAT_PARAMS and not is_last:
                    self._downgrade(mode, modes[position + 1], notes, reason=str(exc))
                    continue
                self._trace(trace_id, request, None, notes, started, total_attempts, error=str(exc))
                raise

            parsed, response, repair_used = await self._parse_or_repair(
                response, request, schema, notes, repair_attempts
            )
            total_attempts += repair_used

            if parsed is not None:
                self._remember_mode(mode)
                meta = self._meta(trace_id, response, started, total_attempts, mode, notes)
                self._trace(
                    trace_id, request, response, notes, started, total_attempts,
                    structured_mode=mode, parsed=parsed.model_dump(mode="json"),
                )
                return StructuredResult[T](value=parsed, raw_text=response.text, meta=meta)

            last_error = LLMResponseFormatError(
                f"model output did not validate against {schema_name} (mode={mode})"
            )
            if not is_last:
                self._downgrade(mode, modes[position + 1], notes, reason="output failed validation")
                continue

            self._trace(
                trace_id, request, response, notes, started, total_attempts,
                structured_mode=mode, error=str(last_error),
            )
            raise last_error

        raise LLMResponseFormatError(
            f"exhausted structured-output modes for {schema_name}: {last_error}"
        )

    async def health(self) -> dict[str, Any]:
        """Cheap liveness probe: one tiny completion."""
        try:
            result = await self.complete(
                messages=[Message.user("ping")],
                max_output_tokens=5,
                timeout_s=min(self.settings.timeout_s, 15.0),
            )
        except LLMError as exc:
            return {"ok": False, "provider": self.provider.name, "error": str(exc)}
        return {
            "ok": True,
            "provider": self.provider.name,
            "model": result.meta.model,
            "latency_ms": result.meta.latency_ms,
        }

    async def aclose(self) -> None:
        await self.provider.aclose()

    # -- internals --------------------------------------------------------
    def _build_request(
        self,
        *,
        messages: list[Message],
        model: str | None,
        temperature: float | None,
        max_output_tokens: int | None,
        timeout_s: float | None,
        seed: int | None,
        response_format: dict[str, Any] | None,
        extra_body: dict[str, Any] | None = None,
    ) -> ChatRequest:
        effective_temperature = (
            self.settings.temperature if temperature is None else temperature
        )
        # Per-call keys win over the deployment's. That direction matters: the
        # settings say what this stage normally does, the call says what this
        # particular run is testing.
        #
        # A per-call `None` *removes* the key (RFC 7396 merge-patch), which is
        # the only way to say "send nothing here" — needed when a call borrows
        # one stage's endpoint but not its vendor settings. Overriding is not
        # enough there: the absence of `thinking` means the provider default,
        # and no value you can send spells that.
        merged_extra: dict[str, Any] | None = {
            **(self.settings.extra_body or {}),
            **(extra_body or {}),
        }
        merged_extra = {k: v for k, v in merged_extra.items() if v is not None} or None
        return ChatRequest(
            messages=messages,
            model=model or self.settings.model,
            temperature=effective_temperature if self.caps.allow_temperature else None,
            max_output_tokens=max_output_tokens or self.settings.max_output_tokens,
            token_param=self.caps.token_param,  # type: ignore[arg-type]
            response_format=response_format,
            timeout_s=timeout_s or self.settings.timeout_s,
            seed=seed,
            extra_body=merged_extra,
        )

    async def _execute(self, request: ChatRequest, notes: list[str]) -> tuple[ChatResponse, int]:
        """Call the provider, absorbing transient failures and bad params."""
        transient = 0
        adaptations: set[str] = set()
        attempts = 0

        while True:
            attempts += 1
            try:
                async with self._semaphore:
                    return await self.provider.chat(request), attempts
            except LLMBadRequestError as exc:
                key = _adaptation_key(exc.param, request.extra_body)
                if key is None or key in adaptations:
                    raise
                adaptations.add(key)
                self._adapt(key, request, notes, reason=str(exc))
            except (LLMTimeoutError, LLMRateLimitError, LLMError) as exc:
                if not exc.retryable or transient >= self.settings.max_retries:
                    raise
                transient += 1
                delay = _backoff(transient)
                notes.append(f"transient {type(exc).__name__}, retry {transient} in {delay:.1f}s")
                logger.warning(
                    "llm call failed, retrying",
                    extra={"attempt": transient, "delay_s": round(delay, 2), "error": str(exc)},
                )
                await asyncio.sleep(delay)

    def _adapt(self, key: str, request: ChatRequest, notes: list[str], *, reason: str) -> None:
        """Drop or flip a parameter the provider just rejected, and remember it."""
        if key == "temperature":
            self.caps.allow_temperature = False
            request.temperature = None
            notes.append("provider rejected `temperature`; dropped for this process")
        elif key == "token_param":
            flipped = (
                "max_completion_tokens"
                if request.token_param == "max_tokens"
                else "max_tokens"
            )
            self.caps.token_param = flipped
            request.token_param = flipped  # type: ignore[assignment]
            notes.append(f"provider rejected token parameter; switched to `{flipped}`")
        elif key == "seed":
            request.seed = None
            notes.append("provider rejected `seed`; dropped")
        elif key == "extra_body":
            # Not remembered on `caps`: unlike temperature this is per-call and
            # deliberate, so silently disabling it for the process would make a
            # later benchmark report a switch that was never actually applied.
            rejected = sorted(request.extra_body or {})
            request.extra_body = None
            notes.append(
                "provider rejected extra body ("
                + ", ".join(rejected)
                + "); dropped and retried without it — this run is NOT the "
                "configuration you asked for"
            )
        logger.info("adapted llm request", extra={"adaptation": key, "reason": reason[:200]})

    def _mode_ladder(self) -> tuple[str, ...]:
        start = self.caps.structured_mode
        if self._ladder_locked:
            return (start,)
        index = _STRUCTURED_LADDER.index(start) if start in _STRUCTURED_LADDER else 0
        return _STRUCTURED_LADDER[index:]

    def _downgrade(self, current: str, nxt: str, notes: list[str], *, reason: str) -> None:
        note = f"structured mode {current} -> {nxt} ({reason[:160]})"
        notes.append(note)
        logger.info("structured output downgraded", extra={"from": current, "to": nxt})

    def _remember_mode(self, mode: str) -> None:
        if not self._ladder_locked:
            self.caps.structured_mode = mode

    @staticmethod
    def _messages_for_mode(
        messages: list[Message], mode: str, json_schema: dict[str, Any]
    ) -> list[Message]:
        if mode == "json_schema":
            # The schema travels in `response_format`; the provider enforces it.
            return messages
        # Neither of the lower rungs enforces a schema, so it has to be spelled
        # out in the prompt -- `json_object` alone only guarantees *some* valid
        # JSON, which is worthless if the model has to guess the field names.
        block = schema_prompt_block(json_schema)
        patched = list(messages)
        for index, message in enumerate(patched):
            if message.role == "system":
                patched[index] = Message.system(f"{message.text}\n\n{block}")
                return patched
        return [Message.system(block), *patched]

    async def _parse_or_repair(
        self,
        response: ChatResponse,
        request: ChatRequest,
        schema: type[T],
        notes: list[str],
        repair_attempts: int,
    ) -> tuple[T | None, ChatResponse, int]:
        used = 0
        current = response

        for round_index in range(repair_attempts + 1):
            try:
                return schema.model_validate_json(extract_json(current.text)), current, used
            except (ValueError, PydanticValidationError) as exc:
                if round_index >= repair_attempts:
                    notes.append(f"parse failed: {type(exc).__name__}")
                    return None, current, used

                notes.append(f"malformed output, requesting repair ({type(exc).__name__})")
                repair = ChatRequest(
                    **request.model_dump(exclude={"messages"}),
                    messages=[
                        *request.messages,
                        Message.assistant(current.text[:4000]),
                        Message.user(
                            "Предыдущий ответ не является валидным JSON нужной схемы "
                            f"(ошибка: {str(exc)[:400]}). Верни ТОЛЬКО исправленный "
                            "JSON-объект, без markdown и без пояснений."
                        ),
                    ],
                )
                try:
                    current, attempts = await self._execute(repair, notes)
                    used += attempts
                except LLMError as repair_error:
                    notes.append(f"repair round failed: {repair_error}")
                    return None, current, used

        return None, current, used

    def _meta(
        self,
        trace_id: str,
        response: ChatResponse,
        started: float,
        attempts: int,
        structured_mode: str | None,
        notes: list[str],
    ) -> CallMeta:
        return CallMeta(
            trace_id=trace_id,
            request_id=get_request_id(),
            provider=response.provider,
            model=response.model,
            usage=response.usage,
            latency_ms=int((time.perf_counter() - started) * 1000),
            attempts=attempts,
            structured_mode=structured_mode,
            finish_reason=response.finish_reason,
            mocked=response.provider == "mock",
            notes=notes,
        )

    def _trace(
        self,
        trace_id: str,
        request: ChatRequest,
        response: ChatResponse | None,
        notes: list[str],
        started: float,
        attempts: int,
        *,
        structured_mode: str | None = None,
        parsed: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self.recorder.record(
            TraceRecord(
                trace_id=trace_id,
                request_id=get_request_id(),
                provider=self.provider.name,
                model=request.model,
                # Image payloads become size markers: a few base64 photographs
                # would be tens of megabytes held in the ring buffer.
                messages=[m.redacted() for m in request.messages],
                request_extra_body=request.extra_body,
                response_text=response.text if response else None,
                parsed=parsed,
                usage=response.usage if response else Usage(),
                latency_ms=int((time.perf_counter() - started) * 1000),
                attempts=attempts,
                structured_mode=structured_mode,
                notes=notes,
                error=error,
            )
        )


def _response_format(
    mode: str, schema_name: str, json_schema: dict[str, Any]
) -> dict[str, Any] | None:
    if mode == "json_schema":
        return {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": json_schema, "strict": True},
        }
    if mode == "json_object":
        return {"type": "json_object"}
    return None


def _adaptation_key(param: str | None, extra_body: dict[str, Any] | None = None) -> str | None:
    if param is None:
        return None
    if param == "temperature":
        return "temperature"
    if param in _TOKEN_PARAMS:
        return "token_param"
    if param == "seed":
        return "seed"
    # Anything we merged in ourselves — `thinking`, a vendor knob from
    # LLM_EXTRA_BODY — is droppable. A feature toggle that spells a provider
    # parameter slightly wrong should cost a note, not the whole grading.
    if extra_body and param.split(".")[0] in extra_body:
        return "extra_body"
    return None


def _backoff(attempt: int, base: float = 0.5, cap: float = 8.0) -> float:
    return min(cap, base * (2 ** (attempt - 1))) * (0.7 + random.random() * 0.6)


# -- construction ---------------------------------------------------------
def build_provider(settings: LLMSettings) -> ChatProvider:
    if settings.provider == "mock":
        return MockProvider()
    if settings.provider == "openai":
        return OpenAIProvider(settings)
    raise LLMConfigError(f"unknown LLM_PROVIDER {settings.provider!r}")


Role = Literal["text", "vision"]

_clients: dict[str, LLMClient] = {}


def get_llm_client(role: Role = "text") -> LLMClient:
    """Process-wide client per role. Singletons, so learned capabilities stick.

    `text` runs stages 2 and 3; `vision` runs stage 1 and may point at a
    different vendor entirely (see `Settings.vision_llm`).
    """
    if role not in _clients:
        settings = get_settings()
        llm_settings = settings.vision_llm if role == "vision" else settings.llm
        _clients[role] = LLMClient(llm_settings, build_provider(llm_settings), get_recorder())
        logger.info(
            "llm client ready",
            extra={
                "role": role,
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "capabilities": _clients[role].caps.snapshot(),
            },
        )
    return _clients[role]


def peek_llm_clients() -> list[LLMClient]:
    """Clients already built -- never constructs one.

    Shutdown uses this: a process that failed to configure a provider has
    nothing to close, and building one just to close it would raise.
    """
    return list(_clients.values())


def reset_llm_client() -> None:
    _clients.clear()
