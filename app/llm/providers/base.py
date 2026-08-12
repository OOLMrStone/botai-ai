"""The contract every backend must satisfy.

Deliberately tiny: one call in, one call out.  Retries, structured-output
negotiation, tracing and capability probing all live in `LLMClient`, so adding
a provider never means reimplementing that logic.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.llm.types import ChatRequest, ChatResponse


@runtime_checkable
class ChatProvider(Protocol):
    name: str

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """Single completion. Must raise an `app.core.errors.LLMError` subclass."""
        ...

    async def aclose(self) -> None:
        ...
