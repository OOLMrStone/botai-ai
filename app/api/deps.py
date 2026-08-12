"""Shared FastAPI dependencies."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header

from app.config import Settings, get_settings
from app.core.errors import DebugAuthError, DebugDisabledError
from app.grading import GradingService, get_grading_service
from app.llm import LLMClient, get_llm_client
from app.llm.recorder import TraceRecorder, get_recorder


def settings_dep() -> Settings:
    return get_settings()


def service_dep() -> GradingService:
    return get_grading_service()


def llm_dep() -> LLMClient:
    return get_llm_client()


def recorder_dep() -> TraceRecorder:
    return get_recorder()


def require_debug(
    x_debug_token: Annotated[str | None, Header(alias="X-Debug-Token")] = None,
    settings: Settings = Depends(settings_dep),
) -> Settings:
    """Gate for every `/debug` route.

    Two independent conditions: the toolkit must be switched on, and the caller
    must present the shared token.  When it is off the answer is 404 rather
    than 403 -- a probe should not learn that the surface exists at all.
    """
    if not settings.debug.enabled:
        raise DebugDisabledError("not found")

    expected = settings.debug.token or ""
    provided = x_debug_token or ""
    if not expected or not hmac.compare_digest(expected, provided):
        raise DebugAuthError("invalid or missing X-Debug-Token header")

    return settings


SettingsDep = Annotated[Settings, Depends(settings_dep)]
ServiceDep = Annotated[GradingService, Depends(service_dep)]
LLMDep = Annotated[LLMClient, Depends(llm_dep)]
RecorderDep = Annotated[TraceRecorder, Depends(recorder_dep)]
DebugGate = Annotated[Settings, Depends(require_debug)]
