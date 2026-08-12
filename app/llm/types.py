"""Provider-agnostic request/response types for the LLM layer."""

from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant"]
T = TypeVar("T", bound=BaseModel)


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ImageUrl(BaseModel):
    url: str = Field(description="https://… or a data: URL with base64 payload")
    detail: Literal["auto", "low", "high"] = "high"


class ImagePart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ImageUrl


ContentPart = TextPart | ImagePart


class Message(BaseModel):
    role: Role
    content: str | list[ContentPart]

    @classmethod
    def system(cls, content: str) -> Message:
        return cls(role="system", content=content)

    @classmethod
    def user(cls, content: str) -> Message:
        return cls(role="user", content=content)

    @classmethod
    def assistant(cls, content: str) -> Message:
        return cls(role="assistant", content=content)

    @classmethod
    def user_with_images(
        cls, text: str, images: list[str], *, detail: Literal["auto", "low", "high"] = "high"
    ) -> Message:
        """Text plus one or more images (data: URLs or https URLs).

        Text first: a model reads the instruction before the picture, and for
        handwriting the instruction is what tells it what it is looking at.
        """
        parts: list[ContentPart] = [TextPart(text=text)]
        parts.extend(ImagePart(image_url=ImageUrl(url=url, detail=detail)) for url in images)
        return cls(role="user", content=parts)

    @property
    def images(self) -> list[ImagePart]:
        if isinstance(self.content, str):
            return []
        return [p for p in self.content if isinstance(p, ImagePart)]

    @property
    def text(self) -> str:
        """Text of the message, images dropped. For logging and prompt previews."""
        if isinstance(self.content, str):
            return self.content
        return "\n".join(p.text for p in self.content if isinstance(p, TextPart))

    def redacted(self) -> Message:
        """Copy with image payloads replaced by a size marker.

        Traces keep the last N calls in memory; a handful of base64 photographs
        would be tens of megabytes, and nobody debugs by reading base64.
        """
        if isinstance(self.content, str):
            return self
        parts: list[ContentPart] = []
        for part in self.content:
            if isinstance(part, ImagePart):
                url = part.image_url.url
                marker = (
                    f"<image {_describe_data_url(url)}>"
                    if url.startswith("data:")
                    else f"<image {url[:120]}>"
                )
                parts.append(TextPart(text=marker))
            else:
                parts.append(part)
        return Message(role=self.role, content=parts)


def _describe_data_url(url: str) -> str:
    header, _, payload = url.partition(",")
    mime = header[5:].split(";")[0] or "unknown"
    return f"{mime}, ~{len(payload) * 3 // 4 // 1024} KB base64"


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # Prompt-cache hits, billed at a fraction of the input rate.
    cached_prompt_tokens: int = 0
    # Already counted inside completion_tokens; broken out because on a
    # reasoning model it is most of the bill and all of the latency.
    reasoning_tokens: int = 0
    # What the provider says it charged. Only some report this; when they do
    # it beats anything computed from a rate table. See llm/pricing.py.
    provider_cost_usd: float | None = None

    def __add__(self, other: Usage) -> Usage:
        costs = [c for c in (self.provider_cost_usd, other.provider_cost_usd) if c is not None]
        return Usage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            cached_prompt_tokens=self.cached_prompt_tokens + other.cached_prompt_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
            provider_cost_usd=sum(costs) if costs else None,
        )


class ChatRequest(BaseModel):
    """What the client hands to a provider. Already fully resolved."""

    model_config = {"protected_namespaces": ()}

    messages: list[Message]
    model: str
    temperature: float | None = None
    max_output_tokens: int | None = None
    token_param: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    response_format: dict[str, Any] | None = None
    timeout_s: float | None = None
    seed: int | None = None
    # Merged into the provider request body verbatim; see LLMSettings.extra_body.
    extra_body: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    text: str
    model: str
    usage: Usage = Field(default_factory=Usage)
    finish_reason: str | None = None
    provider: str = "unknown"
    raw_id: str | None = None


class CallMeta(BaseModel):
    """Everything a caller (or a debug endpoint) wants to know after the fact."""

    model_config = {"protected_namespaces": ()}

    trace_id: str
    request_id: str | None = None
    provider: str
    model: str
    usage: Usage = Field(default_factory=Usage)
    latency_ms: int = 0
    attempts: int = 1
    structured_mode: str | None = None
    finish_reason: str | None = None
    mocked: bool = False
    notes: list[str] = Field(default_factory=list)


class LLMResult(BaseModel):
    text: str
    meta: CallMeta


class StructuredResult(BaseModel, Generic[T]):
    value: T
    raw_text: str
    meta: CallMeta
