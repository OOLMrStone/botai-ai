"""Typed settings, loaded from the environment (and `.env` when present).

Every knob is flat and prefixed so it maps cleanly onto docker compose
`environment:` blocks.  Grouping happens here, not in the variable names'
nesting, because `LLM_MODEL` is far easier to override in a shell than
`LLM__MODEL`.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Imported lazily inside functions elsewhere would be tidier, but features.py
# imports only from core.errors, so there is no cycle to avoid.
from app.features import describe, resolve as resolve_features  # noqa: E402

Environment = Literal["local", "dev", "prod"]
StructuredMode = Literal["auto", "json_schema", "json_object", "prompt"]
TokenParam = Literal["auto", "max_tokens", "max_completion_tokens"]
TriState = Literal["auto", "true", "false"]

_BASE_CONFIG = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    extra="ignore",
    protected_namespaces=(),
)


class AppSettings(BaseSettings):
    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="APP_")

    env: Environment = "local"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    log_format: Literal["console", "json"] = "console"
    # Comma separated. Kept as a plain string because pydantic-settings would
    # otherwise try to JSON-decode a list-typed field and choke on `*`.
    cors_origins: str = "*"
    # Where the editable prompt files live. Empty = <repo>/prompts. Point it
    # elsewhere to run a prompt variant without touching the image.
    prompts_dir: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


class LLMSettings(BaseSettings):
    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="LLM_")

    provider: Literal["openai", "mock"] = "openai"
    api_key: str | None = None
    base_url: str | None = None
    model: str = "gpt-5"
    timeout_s: float = 120.0
    max_retries: int = 3
    temperature: float = 0.2
    max_output_tokens: int = 4000
    # How to ask the model for JSON. `auto` starts at json_schema and walks
    # down the ladder when the provider rejects it -- see llm/client.py.
    structured_mode: StructuredMode = "auto"
    # Newer OpenAI models renamed `max_tokens` -> `max_completion_tokens` and
    # dropped custom temperatures. `auto` guesses, then self-corrects on 400.
    token_param: TokenParam = "auto"
    supports_temperature: TriState = "auto"
    concurrency: int = 8
    # Provider-specific parameters merged into the request body verbatim, as
    # a JSON object. The escape hatch for things no OpenAI-compatible schema
    # covers -- notably switching a reasoning model's thinking off:
    #   LLM_VISION_EXTRA_BODY={"thinking":{"type":"disabled"}}
    # Set per stage: transcription does not benefit from chain-of-thought,
    # while finding maths errors very much does.
    extra_body: dict[str, Any] | None = None
    # Rate overrides for cost reporting, USD per million tokens:
    #   LLM_PRICING={"deepseek-v4-flash":{"input":0.28,"output":0.42}}
    # Merged over the built-in table; see llm/pricing.py.
    pricing: dict[str, Any] | None = None

    @field_validator("extra_body", "pricing", mode="before")
    @classmethod
    def _parse_extra_body(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"EXTRA_BODY must be a JSON object: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("EXTRA_BODY must be a JSON object")
            return parsed
        return value


class VisionOverrides(BaseSettings):
    """Stage-1-only overrides, prefixed `LLM_VISION_`.

    Stage 1 reads a photograph; stages 2 and 3 only read text. Those are
    different capabilities and often different vendors — DeepSeek V4, for
    instance, is text-only, so it can run the reasoning stages while a
    vision-capable endpoint handles transcription. Any field left empty falls
    back to the corresponding `LLM_*` value.
    """

    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="LLM_VISION_")

    provider: Literal["openai", "mock"] | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    max_output_tokens: int | None = None
    extra_body: dict[str, Any] | None = None

    @field_validator(
        "provider", "api_key", "base_url", "model", "max_output_tokens", "extra_body",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: Any) -> Any:
        # `LLM_VISION_MODEL=` in a .env means "not configured", not "empty model".
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("extra_body", mode="before")
    @classmethod
    def _parse_extra_body(cls, value: Any) -> Any:
        return LLMSettings._parse_extra_body(value)


class FeatureSettings(BaseSettings):
    """Deployment-level toggle defaults, over the registry in `app/features.py`.

    One JSON var rather than a field per flag: the registry is the source of
    truth for what exists, and mirroring it here would mean editing two files
    to add a toggle and would silently drift.

        FEATURES={"solve_independently": false}
    """

    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="")

    features: dict[str, Any] | None = Field(default=None, alias="FEATURES")

    @field_validator("features", mode="before")
    @classmethod
    def _parse(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"FEATURES must be a JSON object: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("FEATURES must be a JSON object")
            return parsed
        return value


class GradingSettings(BaseSettings):
    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="GRADING_")

    # Grade the same work N times and take the median score. 1 disables it.
    self_consistency: int = Field(default=1, ge=1, le=5)
    batch_limit: int = Field(default=20, ge=1, le=200)


class DebugSettings(BaseSettings):
    model_config = _BASE_CONFIG | SettingsConfigDict(env_prefix="DEBUG_")

    enabled: bool = False
    token: str | None = None
    allow_in_prod: bool = False
    record_traces: bool = True
    trace_limit: int = Field(default=100, ge=1, le=10_000)
    # Where run reports are written. Empty = memory only, capped and lost on
    # restart — fine locally, useless for a deployment testers use for days.
    reports_dir: str = ""
    report_limit: int = Field(default=20, ge=1, le=10_000)


class Settings(BaseModel):
    app: AppSettings
    llm: LLMSettings
    vision: VisionOverrides
    grading: GradingSettings
    debug: DebugSettings
    features: FeatureSettings = Field(default_factory=FeatureSettings)

    @property
    def vision_llm(self) -> LLMSettings:
        """`LLM_*` with any `LLM_VISION_*` override applied."""
        overrides = {k: v for k, v in self.vision.model_dump().items() if v is not None}
        if not overrides:
            return self.llm
        return self.llm.model_copy(update=overrides)

    def redacted(self) -> dict[str, Any]:
        """Full effective config with secrets masked. Feeds `/debug/config`."""
        data = self.model_dump(mode="json")
        data["llm"]["api_key"] = _mask(self.llm.api_key)
        data["vision"]["api_key"] = _mask(self.vision.api_key)
        data["debug"]["token"] = _mask(self.debug.token)
        data["features"] = describe(
            resolve_features(configured=self.features.features)
        )
        data["effective_vision"] = {
            "provider": self.vision_llm.provider,
            "model": self.vision_llm.model,
            "base_url": self.vision_llm.base_url,
            "api_key": _mask(self.vision_llm.api_key),
            # Stage 1 routinely differs from the text stages on these two, and
            # "why is transcription slow" is answered by exactly this line.
            "max_output_tokens": self.vision_llm.max_output_tokens,
            "extra_body": self.vision_llm.extra_body,
        }
        return data


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


def build_settings() -> Settings:
    settings = Settings(
        app=AppSettings(),
        llm=LLMSettings(),
        vision=VisionOverrides(),
        grading=GradingSettings(),
        debug=DebugSettings(),
        features=FeatureSettings(),
    )

    # Fail at startup, not on the first grading request: an unknown key in
    # FEATURES is a typo, and a typo that silently does nothing is worse than
    # a service that refuses to start.
    resolve_features(configured=settings.features.features)

    # Safety interlock: the debug toolkit exposes prompts, traces and score
    # overrides. It must not come up in prod by accident.
    if settings.debug.enabled and settings.app.is_prod and not settings.debug.allow_in_prod:
        logger.error(
            "DEBUG_ENABLED=true with APP_ENV=prod: refusing to expose the debug "
            "toolkit. Set DEBUG_ALLOW_IN_PROD=true if this is really intended."
        )
        settings.debug.enabled = False

    if settings.debug.enabled and not settings.debug.token:
        logger.error(
            "DEBUG_ENABLED=true but DEBUG_TOKEN is empty: disabling the debug "
            "toolkit. Set DEBUG_TOKEN to a non-empty value to use it."
        )
        settings.debug.enabled = False

    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return build_settings()


def reset_settings_cache() -> None:
    """Drop the cached settings. Used by tests and `/debug/config/reload`."""
    get_settings.cache_clear()
