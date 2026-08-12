"""Deterministic offline provider -- the workhorse of the debug toolkit.

`LLM_PROVIDER=mock` makes the whole service run end to end with no API key,
no network and no spend, which is what CI and most frontend work want.

Three ways to drive it:

1. **Synthesised** (default) -- when a JSON schema was requested it builds a
   schema-valid instance, seeded by a hash of the prompt.  Same prompt in,
   same answer out, so assertions are stable.
2. **Scripted** -- `push_text(...)` / `push_error(...)` queue exact replies,
   including failures, to exercise retry and fallback paths.  Reachable over
   HTTP via `POST /debug/llm/mock/script`.
3. **Prompt markers** -- a prompt containing `[[MOCK_SCORE=3]]` pins the
   synthesised score, so a test can ask for a specific verdict without
   knowing anything about the seeding.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections import deque
from typing import Any

from app.core.errors import (
    LLMError,
    LLMRateLimitError,
    LLMResponseFormatError,
    LLMTimeoutError,
)
from app.llm.types import ChatRequest, ChatResponse, Usage

logger = logging.getLogger(__name__)

_SCORE_MARKER = re.compile(r"\[\[MOCK_SCORE=(-?\d+)]]")

_ERRORS: dict[str, type[LLMError]] = {
    "timeout": LLMTimeoutError,
    "rate_limit": LLMRateLimitError,
    "bad_response": LLMResponseFormatError,
    "generic": LLMError,
}

_RU_SENTENCES = (
    "Ход решения в целом верный, обоснования присутствуют.",
    "Допущена вычислительная ошибка, не влияющая на метод решения.",
    "Не обоснован переход к следствию, требуется проверка корней.",
    "Отбор корней выполнен неполно.",
    "Ответ получен верно, решение оформлено аккуратно.",
)


class _Scripted:
    __slots__ = ("text", "error")

    def __init__(self, text: str | None = None, error: LLMError | None = None) -> None:
        self.text = text
        self.error = error


class MockProvider:
    name = "mock"

    def __init__(self, latency_ms: int = 0) -> None:
        self._queue: deque[_Scripted] = deque()
        self.latency_ms = latency_ms
        self.calls: list[ChatRequest] = []

    # -- scripting -------------------------------------------------------
    def push_text(self, text: str) -> None:
        self._queue.append(_Scripted(text=text))

    def push_error(self, kind: str = "generic", message: str = "scripted failure") -> None:
        error_cls = _ERRORS.get(kind)
        if error_cls is None:
            raise ValueError(f"unknown error kind {kind!r}; expected one of {sorted(_ERRORS)}")
        self._queue.append(_Scripted(error=error_cls(message)))

    def push_exception(self, error: LLMError) -> None:
        """Queue an exact exception instance -- e.g. a `LLMBadRequestError`
        carrying a specific `param`, to drive the client's capability fallback."""
        self._queue.append(_Scripted(error=error))

    def reset(self) -> None:
        self._queue.clear()
        self.calls.clear()

    @property
    def queued(self) -> int:
        return len(self._queue)

    # -- provider protocol -----------------------------------------------
    async def chat(self, request: ChatRequest) -> ChatResponse:
        self.calls.append(request)
        if self.latency_ms:
            await asyncio.sleep(self.latency_ms / 1000)

        if self._queue:
            scripted = self._queue.popleft()
            if scripted.error is not None:
                raise scripted.error
            text = scripted.text or ""
        else:
            text = self._synthesise(request)

        prompt_chars = sum(len(m.text) for m in request.messages)
        return ChatResponse(
            text=text,
            model=request.model,
            usage=Usage(
                prompt_tokens=prompt_chars // 4,
                completion_tokens=len(text) // 4,
                total_tokens=(prompt_chars + len(text)) // 4,
            ),
            finish_reason="stop",
            provider=self.name,
            raw_id="mock",
        )

    async def aclose(self) -> None:
        return None

    # -- synthesis --------------------------------------------------------
    def _synthesise(self, request: ChatRequest) -> str:
        # `.text` drops image parts: the mock is deterministic on the *instruction*,
        # so a re-upload of the same photo does not change the synthetic answer.
        prompt = "\n".join(m.text for m in request.messages)
        seed = int(hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12], 16)

        forced = _SCORE_MARKER.search(prompt)
        forced_score = int(forced.group(1)) if forced else None

        # Structured output arrives one of two ways depending on which rung of
        # the client's ladder we are on: in `response_format` (json_schema mode)
        # or inlined in the prompt (json_object / prompt modes). Honour both, so
        # a fallback path is just as testable as the happy one.
        schema = _requested_schema(request.response_format) or _schema_from_prompt(prompt)
        if schema is None:
            return f"[mock reply seed={seed % 100000}]"

        value = _from_schema(schema, schema, seed, forced_score=forced_score)
        return json.dumps(value, ensure_ascii=False)


def _requested_schema(response_format: dict[str, Any] | None) -> dict[str, Any] | None:
    if not response_format:
        return None
    if response_format.get("type") == "json_schema":
        wrapper = response_format.get("json_schema") or {}
        schema = wrapper.get("schema")
        return schema if isinstance(schema, dict) else None
    return None


def _schema_from_prompt(prompt: str) -> dict[str, Any] | None:
    """Recover a schema that `schema_prompt_block()` inlined into the prompt."""
    marker = prompt.rfind("схеме:")
    if marker == -1:
        return None
    from app.llm.schema import extract_json

    try:
        candidate = json.loads(extract_json(prompt[marker + len("схеме:") :]))
    except ValueError:
        return None
    return candidate if isinstance(candidate, dict) and "properties" in candidate else None


def _from_schema(
    node: dict[str, Any],
    root: dict[str, Any],
    seed: int,
    *,
    field: str = "",
    depth: int = 0,
    forced_score: int | None = None,
) -> Any:
    if depth > 12:
        return None

    if "$ref" in node:
        target = _resolve_ref(node["$ref"], root)
        return _from_schema(target, root, seed, field=field, depth=depth + 1, forced_score=forced_score)

    if "enum" in node and node["enum"]:
        options = node["enum"]
        return options[seed % len(options)]

    if "anyOf" in node or "oneOf" in node:
        branches = node.get("anyOf") or node["oneOf"]
        concrete = [b for b in branches if b.get("type") != "null"] or branches
        return _from_schema(
            concrete[seed % len(concrete)], root, seed, field=field, depth=depth + 1, forced_score=forced_score
        )

    node_type = node.get("type")
    if isinstance(node_type, list):
        node_type = next((t for t in node_type if t != "null"), "string")

    if node_type == "object" or "properties" in node:
        result: dict[str, Any] = {}
        for index, (key, sub) in enumerate((node.get("properties") or {}).items()):
            result[key] = _from_schema(
                sub, root, seed + index * 7919, field=key, depth=depth + 1, forced_score=forced_score
            )
        return result

    if node_type == "array":
        items = node.get("items") or {"type": "string"}
        count = 1 + (seed % 2)
        return [
            _from_schema(items, root, seed + i * 104729, field=field, depth=depth + 1, forced_score=forced_score)
            for i in range(count)
        ]

    if node_type == "integer":
        return _integer_for(field, seed, forced_score)
    if node_type == "number":
        if "confidence" in field or "probability" in field:
            return round(0.55 + (seed % 40) / 100, 2)
        return float(_integer_for(field, seed, forced_score))
    if node_type == "boolean":
        return _boolean_for(field, seed)
    if node_type == "null":
        return None

    return _string_for(field, seed)


_PRESENCE_PREFIXES = ("is_", "has_", "was_", "found", "solved", "student_answer_correct")
_NEGATIVE_PREFIXES = ("blocks_", "affects_", "propagates", "label_is_inferred")


def _boolean_for(field: str, seed: int) -> bool:
    """Sensible defaults rather than a coin flip.

    A random `is_solution_present: false` short-circuits the whole pipeline, so
    a mock run would exercise nothing. Presence-style flags default to true and
    problem-style flags to false, which makes the offline path walk the same
    route a real submission does.
    """
    lowered = field.lower()
    if lowered.startswith(_PRESENCE_PREFIXES):
        return True
    if lowered.startswith(_NEGATIVE_PREFIXES):
        return False
    return seed % 2 == 0


def _integer_for(field: str, seed: int, forced_score: int | None) -> int:
    if "score" in field and "max" not in field:
        if forced_score is not None:
            return forced_score
        return seed % 3
    if "max" in field:
        return 4
    return seed % 10


def _string_for(field: str, seed: int) -> str:
    if not field:
        return _RU_SENTENCES[seed % len(_RU_SENTENCES)]
    lowered = field.lower()
    if "answer" in lowered:
        return f"{seed % 20}"
    if any(word in lowered for word in ("summary", "comment", "description", "feedback", "reason")):
        return _RU_SENTENCES[seed % len(_RU_SENTENCES)]
    if "where" in lowered or "step" in lowered:
        return f"пункт {'аб'[seed % 2]})"
    return f"mock:{lowered}:{seed % 1000}"


def _resolve_ref(ref: str, root: dict[str, Any]) -> dict[str, Any]:
    if not ref.startswith("#/"):
        return {}
    node: Any = root
    for part in ref[2:].split("/"):
        if not isinstance(node, dict):
            return {}
        node = node.get(part, {})
    return node if isinstance(node, dict) else {}
