"""Debug toolkit.

Everything here is mounted only when `DEBUG_ENABLED=true`, and every route
additionally demands the `X-Debug-Token` header (see `deps.require_debug`).
When the toolkit is off the whole prefix answers 404.

What it buys you, roughly in order of how often it gets used:

    POST /debug/grading/preview-prompt   see the exact prompt, spend nothing
    GET  /debug/llm/traces               what we sent, what came back, why it retried
    POST /debug/grading/sample           end-to-end run on a built-in work
    POST /debug/llm/mock/script          force the next model reply, or a failure
    POST /debug/llm/echo                 raw prompt playground
    GET  /debug/config                   effective settings, secrets masked

Full walkthrough in docs/DEBUG_TOOLKIT.md.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.api.deps import DebugGate, LLMDep, RecorderDep, ServiceDep
from app.config import reset_settings_cache
from app.core.errors import NotFoundError
from app.domain.samples import SAMPLES, get_sample
from app.features import describe as describe_features
from app.features import resolve as resolve_features
from app.domain.schemas import GradeRequest, GradeResponse, LLMVerdict
from app.domain.tasks import CRITERIA_SOURCE, TASK_REGISTRY
from app.grading import prompts
from app.llm.providers import MockProvider
from app.llm.recorder import TraceRecord
from app.llm.pricing import load_rates
from app.llm.schema import to_strict_schema
from app.llm.types import Message
from app.reporting import get_report_store, to_markdown

router = APIRouter(prefix="/debug", tags=["debug"])


# --------------------------------------------------------------------------
# basics
# --------------------------------------------------------------------------
@router.get("/ping", summary="Is the toolkit reachable and is my token right?")
async def ping(_: DebugGate) -> dict[str, str]:
    return {"pong": "ok"}


@router.get("/config", summary="Effective settings, secrets masked")
async def config(settings: DebugGate) -> dict[str, Any]:
    return settings.redacted()


@router.post("/config/reload", summary="Re-read settings from the environment")
async def reload_config(_: DebugGate) -> dict[str, str]:
    """Drops the settings cache.

    Note the singletons built *from* those settings (LLM client, grading
    service) are not rebuilt -- a provider swap still wants a restart. Handy
    for tweaking timeouts and log levels without one.
    """
    reset_settings_cache()
    return {"status": "settings cache cleared"}


@router.get("/tasks", summary="Task registry with provenance")
async def tasks(_: DebugGate) -> dict[str, Any]:
    return {
        "criteria_source": CRITERIA_SOURCE,
        "tasks": {number: spec.model_dump() for number, spec in TASK_REGISTRY.items()},
        "llm_verdict_schema": to_strict_schema(LLMVerdict),
    }


# --------------------------------------------------------------------------
# traces
# --------------------------------------------------------------------------
@router.get("/llm/traces", summary="Recent model calls, newest first")
async def traces(
    _: DebugGate,
    recorder: RecorderDep,
    limit: int = Query(default=20, ge=1, le=500),
) -> dict[str, Any]:
    return {
        "enabled": recorder.enabled,
        "stored": len(recorder),
        "items": [t.model_dump() for t in recorder.list(limit)],
    }


@router.get("/llm/traces/{trace_id}", summary="One call in full")
async def trace(_: DebugGate, recorder: RecorderDep, trace_id: str) -> TraceRecord:
    found = recorder.get(trace_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"trace {trace_id} not found")
    return found


@router.delete("/llm/traces", summary="Empty the ring buffer")
async def clear_traces(_: DebugGate, recorder: RecorderDep) -> dict[str, str]:
    recorder.clear()
    return {"status": "cleared"}


# --------------------------------------------------------------------------
# raw model access
# --------------------------------------------------------------------------
class EchoRequest(BaseModel):
    model_config = {"protected_namespaces": ()}

    messages: list[Message] = Field(min_length=1)
    model: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    as_verdict: bool = Field(
        default=False,
        description="Прогнать через structured output со схемой LLMVerdict",
    )


@router.post("/llm/echo", summary="Send a raw prompt and see exactly what returns")
async def echo(_: DebugGate, client: LLMDep, request: EchoRequest) -> dict[str, Any]:
    if request.as_verdict:
        structured = await client.complete_structured(
            messages=request.messages,
            schema=LLMVerdict,
            model=request.model,
            temperature=request.temperature,
            max_output_tokens=request.max_output_tokens,
        )
        return {
            "value": structured.value.model_dump(),
            "raw_text": structured.raw_text,
            "meta": structured.meta.model_dump(),
        }

    result = await client.complete(
        messages=request.messages,
        model=request.model,
        temperature=request.temperature,
        max_output_tokens=request.max_output_tokens,
    )
    return {"text": result.text, "meta": result.meta.model_dump()}


@router.get("/llm/health", summary="Live probe against the configured provider")
async def llm_health(_: DebugGate, client: LLMDep) -> dict[str, Any]:
    return {"probe": await client.health(), "capabilities": client.caps.snapshot()}


# --------------------------------------------------------------------------
# mock provider control
# --------------------------------------------------------------------------
class ScriptRequest(BaseModel):
    """Queue one reply. Replies are consumed FIFO, one per model call."""

    text: str | None = Field(default=None, description="Точный текст ответа модели")
    error: Literal["timeout", "rate_limit", "bad_response", "generic"] | None = Field(
        default=None, description="Вместо ответа — сымитировать сбой"
    )
    message: str = "scripted failure"


def _mock_or_400(client: LLMDep) -> MockProvider:
    provider = client.provider
    if not isinstance(provider, MockProvider):
        raise HTTPException(
            status_code=400,
            detail=f"mock controls need LLM_PROVIDER=mock (current: {provider.name})",
        )
    return provider


@router.get("/llm/mock", summary="Mock provider state")
async def mock_state(_: DebugGate, client: LLMDep) -> dict[str, Any]:
    provider = _mock_or_400(client)
    return {
        "queued_replies": provider.queued,
        "calls_seen": len(provider.calls),
        "latency_ms": provider.latency_ms,
    }


@router.post("/llm/mock/script", summary="Queue the next reply (or failure)")
async def mock_script(_: DebugGate, client: LLMDep, request: ScriptRequest) -> dict[str, Any]:
    provider = _mock_or_400(client)
    if (request.text is None) == (request.error is None):
        raise HTTPException(status_code=422, detail="pass exactly one of `text` or `error`")

    if request.error is not None:
        provider.push_error(request.error, request.message)
    else:
        provider.push_text(request.text or "")
    return {"queued_replies": provider.queued}


@router.post("/llm/mock/latency", summary="Simulate a slow model")
async def mock_latency(
    _: DebugGate, client: LLMDep, latency_ms: int = Body(embed=True, ge=0, le=60_000)
) -> dict[str, int]:
    provider = _mock_or_400(client)
    provider.latency_ms = latency_ms
    return {"latency_ms": provider.latency_ms}


@router.delete("/llm/mock", summary="Clear the queue and the call log")
async def mock_reset(_: DebugGate, client: LLMDep) -> dict[str, str]:
    _mock_or_400(client).reset()
    return {"status": "reset"}


# --------------------------------------------------------------------------
# grading introspection
# --------------------------------------------------------------------------
@router.post("/grading/preview-prompt", summary="Render the prompt without calling the model")
async def preview_prompt(_: DebugGate, service: ServiceDep, request: GradeRequest) -> dict[str, Any]:
    spec, criteria, max_score = service.resolve(request)
    messages = prompts.build_messages(request, spec, criteria, max_score)
    rendered = prompts.render(messages)
    return {
        "task": {"number": spec.number, "topic": spec.topic, "max_score": max_score},
        "criteria_source": None if request.criteria_override else CRITERIA_SOURCE,
        "messages": rendered,
        "char_count": sum(len(m["content"]) for m in rendered),
        "approx_tokens": sum(len(m["content"]) for m in rendered) // 3,
    }


@router.get("/samples", summary="Built-in sample works")
async def samples(_: DebugGate) -> dict[str, Any]:
    return {name: sample.model_dump() for name, sample in SAMPLES.items()}


@router.post("/grading/sample", summary="Grade a built-in sample end to end")
async def grade_sample(
    _: DebugGate,
    service: ServiceDep,
    name: str = Query(default="13_partial", description="Имя из GET /debug/samples"),
) -> GradeResponse:
    sample = get_sample(name)
    if sample is None:
        raise HTTPException(
            status_code=404, detail=f"unknown sample {name!r}; available: {sorted(SAMPLES)}"
        )
    return await service.grade(sample.request)


# --- run reports ----------------------------------------------------------
@router.get("/reports", summary="Recent runs, newest first")
def list_reports(_: DebugGate) -> dict[str, Any]:
    """Index only. Full reports carry every prompt, so they are fetched by id."""
    store = get_report_store()
    return {
        "stored": len(store.list()),
        "items": [
            {
                "request_id": r.request_id,
                "created_at": r.created_at,
                "task_number": r.task_number,
                "ok": r.ok,
                "error": (r.error or {}).get("code"),
                "scores": (
                    [r.grades["base"]["score"], r.grades["presentation"]["score"]]
                    if r.grades else None
                ),
                "latency_ms": r.total_latency_ms,
                "total_tokens": r.total_usage.get("total_tokens", 0),
                "cost_usd": r.total_cost.usd,
                "cost_source": r.total_cost.source,
            }
            for r in store.list()
        ],
    }


@router.get("/reports/{request_id}", summary="One run in full — the file testers send back")
def get_report(
    _: DebugGate,
    request_id: str,
    fmt: Literal["json", "md"] = Query("json", description="json for tooling, md to read"),
    download: bool = Query(True, description="Content-Disposition: attachment"),
) -> Response:
    """Everything about one run: prompts, raw output, timings, tokens, cost.

    Secrets are already masked — `RunReport.config` comes from
    `Settings.redacted()`. These files are meant to be sent to other people.
    """
    report = get_report_store().get(request_id)
    if report is None:
        # ServiceError, not HTTPException, so this renders in the same
        # {"error": {code, message}} envelope as every other failure.
        raise NotFoundError(
            f"нет отчёта {request_id}; хранятся только последние "
            f"{len(get_report_store().list())} запусков",
            details={"request_id": request_id},
        )

    if fmt == "md":
        body, media, ext = to_markdown(report), "text/markdown; charset=utf-8", "md"
    else:
        body = report.model_dump_json(indent=2)
        media, ext = "application/json; charset=utf-8", "json"

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="report_{request_id}.{ext}"'
    return Response(content=body, media_type=media, headers=headers)


@router.get("/pricing", summary="Rate table used for cost estimates")
def pricing_table(settings: DebugGate) -> dict[str, Any]:
    """What the money numbers are computed from, and how trustworthy they are."""
    rates = load_rates(settings.llm.pricing)
    return {
        "units": "USD per 1M tokens",
        "warning": (
            "Built-in rates are unverified list prices and go stale. A cost with "
            "source=table is an estimate; source=provider is what the provider charged. "
            "Override with LLM_PRICING."
        ),
        "overridden": sorted((settings.llm.pricing or {}).keys()),
        "rates": {name: rate.model_dump() for name, rate in sorted(rates.items())},
    }


@router.get("/features", summary="Feature-флаги: что есть, что включено")
def list_features(settings: DebugGate) -> dict[str, Any]:
    """The toggle registry, with the state this deployment resolved to.

    Feeds the panel on the test page. Flip one per request via `features` on
    a grading call — same photo, one flag different, two reports to compare.
    """
    active = resolve_features(configured=settings.features.features)
    return {
        "features": describe_features(active),
        "configured": settings.features.features or {},
        "hint": (
            "Переопределить на один запрос: features={\"solve_independently\": false}. "
            "Значения по умолчанию — в app/features.py; развёртывание меняет их через FEATURES."
        ),
    }
