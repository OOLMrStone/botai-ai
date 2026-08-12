"""What a request cost.

Two sources, in order of trust:

1. **The provider told us.** OpenRouter returns `cost` on every completion.
   That is the real charge; nothing here can improve on it.
2. **We computed it** from a rate table. DeepSeek and OpenAI do not return a
   cost, so the tokens are multiplied by a published rate.

The distinction is carried in `source` and never smoothed over. A computed
figure is an estimate made from a table someone typed in, and a report that
presents it as a bill invites a nasty surprise on the invoice.

Rates go stale. `LLM_PRICING` overrides the table without a code change:

    LLM_PRICING={"deepseek-v4-flash":{"input":0.28,"cached_input":0.028,"output":0.42}}

Units are **US dollars per million tokens**, matching how vendors publish
them, so a rate can be copied off a pricing page without arithmetic.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from app.llm.types import Usage

logger = logging.getLogger(__name__)

PER_MILLION = 1_000_000


class ModelRate(BaseModel):
    """USD per million tokens."""

    input: float = 0.0
    output: float = 0.0
    # Prompt-cache hits bill at a fraction of the input rate. DeepSeek caches
    # automatically, and our prompts share a long fixed preamble, so on a
    # repeated task this is most of the prompt.
    cached_input: float | None = None
    note: str = ""


# Published list prices, US dollars per million tokens.
#
# VERIFY THESE AGAINST YOUR PROVIDER'S PRICING PAGE BEFORE TRUSTING A TOTAL.
# They are a convenience so the reports show a number rather than "unknown";
# they are not a contract, they are not updated automatically, and vendors
# change them. Override with LLM_PRICING rather than editing this file, so a
# rebuild is not needed and the override travels with the deployment.
DEFAULT_RATES: dict[str, ModelRate] = {
    "deepseek-v4-flash": ModelRate(
        input=0.28, cached_input=0.028, output=0.42, note="unverified list price"
    ),
    "deepseek-v4-pro": ModelRate(
        input=0.55, cached_input=0.055, output=2.19, note="unverified list price"
    ),
    "deepseek-v4-flash-vision-exp": ModelRate(
        input=0.28, cached_input=0.028, output=0.42, note="unverified list price"
    ),
}


class CostBreakdown(BaseModel):
    """Money for one model call. `usd is None` means genuinely unknown."""

    usd: float | None = None
    source: str = "unknown"  # provider | table | unknown
    model: str = ""
    rate: ModelRate | None = None
    detail: dict[str, float] = Field(default_factory=dict)

    @property
    def is_estimate(self) -> bool:
        return self.source == "table"


def _lookup(model: str, rates: dict[str, ModelRate]) -> ModelRate | None:
    if model in rates:
        return rates[model]
    # OpenRouter prefixes a vendor ("nvidia/nemotron-…") and suffixes a tier
    # (":free"); a bare model name in the table should still match.
    bare = model.split("/")[-1].split(":")[0]
    if bare in rates:
        return rates[bare]
    if model.endswith(":free"):
        return ModelRate(note="free tier")
    return None


def price(usage: Usage, model: str, rates: dict[str, ModelRate] | None = None) -> CostBreakdown:
    """Cost of one call, preferring what the provider charged."""
    if usage.provider_cost_usd is not None:
        return CostBreakdown(
            usd=round(usage.provider_cost_usd, 6), source="provider", model=model
        )

    table = rates if rates is not None else DEFAULT_RATES
    rate = _lookup(model, table)
    if rate is None:
        return CostBreakdown(source="unknown", model=model)

    # Vendors bill cache hits separately; the remaining prompt tokens pay full
    # rate. Subtracting avoids charging the cached portion twice.
    cached = max(0, usage.cached_prompt_tokens)
    fresh = max(0, usage.prompt_tokens - cached)
    cached_rate = rate.cached_input if rate.cached_input is not None else rate.input

    fresh_usd = fresh * rate.input / PER_MILLION
    cached_usd = cached * cached_rate / PER_MILLION
    # Reasoning tokens are billed as output; providers already count them in
    # completion_tokens, so they are not added again here.
    output_usd = usage.completion_tokens * rate.output / PER_MILLION

    return CostBreakdown(
        usd=round(fresh_usd + cached_usd + output_usd, 6),
        source="table",
        model=model,
        rate=rate,
        detail={
            "prompt_fresh_usd": round(fresh_usd, 6),
            "prompt_cached_usd": round(cached_usd, 6),
            "output_usd": round(output_usd, 6),
        },
    )


def total(costs: list[CostBreakdown]) -> CostBreakdown:
    """Sum across stages, degrading honestly.

    A run where one stage's price is unknown has an unknown total. Reporting
    the sum of the stages we happen to know would understate it silently, so
    the total is marked partial instead.
    """
    known = [c for c in costs if c.usd is not None]
    if not costs:
        return CostBreakdown(source="unknown")
    summed = round(sum(c.usd or 0.0 for c in known), 6)
    if len(known) < len(costs):
        return CostBreakdown(
            usd=summed,
            source="partial",
            detail={"priced_calls": float(len(known)), "total_calls": float(len(costs))},
        )
    sources = {c.source for c in known}
    if sources == {"mock"}:
        # Nothing reached a provider. Calling this an estimate would suggest a
        # rate table was consulted and a real run would cost about this much,
        # when in fact no money was ever in play.
        resolved = "mock"
    elif sources == {"provider"}:
        resolved = "provider"
    else:
        resolved = "table"
    return CostBreakdown(
        usd=summed,
        source=resolved,
        detail={"calls": float(len(known))},
    )


def load_rates(override: dict[str, Any] | None) -> dict[str, ModelRate]:
    """Merge `LLM_PRICING` over the defaults."""
    rates = dict(DEFAULT_RATES)
    for model, raw in (override or {}).items():
        try:
            rates[model] = ModelRate(**raw) if isinstance(raw, dict) else ModelRate()
        except Exception:  # noqa: BLE001 - a bad rate must not break grading
            logger.warning("ignoring malformed LLM_PRICING entry for %s", model)
    return rates
