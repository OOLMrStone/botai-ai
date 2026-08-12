"""Liveness and readiness."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app import __version__
from app.api.deps import SettingsDep
from app.core.errors import LLMError
from app.llm import get_llm_client

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness — never touches the model")
async def health(settings: SettingsDep) -> dict[str, Any]:
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.app.env,
        "llm_provider": settings.llm.provider,
        "debug_tools": settings.debug.enabled,
    }


@router.get("/health/ready", summary="Readiness — config check, optional live probe")
async def ready(
    settings: SettingsDep,
    probe: bool = Query(default=False, description="Actually call the model (costs a token or two)"),
) -> dict[str, Any]:
    """Always answers 200 with a status field.

    The LLM client is fetched defensively rather than through a dependency: a
    missing API key must read as `degraded` here, not as a 500 from the
    dependency graph. An orchestrator polling readiness needs a diagnosis, and
    a stack trace is not one.
    """
    llm: dict[str, Any] = {
        "provider": settings.llm.provider,
        "model": settings.llm.model,
        "configured": settings.llm.provider == "mock" or bool(settings.llm.api_key),
    }
    payload: dict[str, Any] = {"status": "ok" if llm["configured"] else "degraded", "llm": llm}

    try:
        client = get_llm_client()
    except LLMError as exc:
        llm["configured"] = False
        llm["error"] = str(exc)
        payload["status"] = "degraded"
        return payload

    llm["capabilities"] = client.caps.snapshot()
    if probe:
        llm["probe"] = await client.health()
        if not llm["probe"]["ok"]:
            payload["status"] = "degraded"
    return payload
