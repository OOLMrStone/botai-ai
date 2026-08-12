"""ASGI entry point.

    uvicorn app.main:app --reload

The debug router is *mounted* only when the toolkit is enabled, on top of the
per-request token check, so a production process does not even carry the
routes in its OpenAPI schema.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import routes_debug, routes_grading, routes_health, routes_photo
from app.config import Settings, get_settings
from app.core.context import get_request_id, new_id, set_request_id
from app.core.errors import ServiceError
from app.core.logging import configure_logging
from app.llm import peek_llm_clients, reset_llm_client

logger = logging.getLogger(__name__)

DESCRIPTION = """\
Проверка заданий второй части (13–19) ЕГЭ по профильной математике с помощью LLM.

* `POST /api/v1/grade` — проверить решение
* `GET /api/v1/tasks` — задания и критерии
* `/debug/*` — инструменты отладки (только при `DEBUG_ENABLED=true` \
и заголовке `X-Debug-Token`)
"""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings: Settings = _app.state.settings
    logger.info(
        "service starting",
        extra={
            "version": __version__,
            "env": settings.app.env,
            "llm_provider": settings.llm.provider,
            "llm_model": settings.llm.model,
            "self_consistency": settings.grading.self_consistency,
        },
    )
    if settings.debug.enabled:
        logger.warning(
            "DEBUG TOOLKIT IS ENABLED at /debug (prompt dumps, trace history, "
            "forced scores). Never run like this in production."
        )
    if settings.llm.provider == "mock":
        logger.warning("LLM_PROVIDER=mock — grades are synthetic, no model is being called.")

    try:
        yield
    finally:
        # Only close what was actually built. A process whose provider never
        # constructed (no API key) must still shut down cleanly.
        for client in peek_llm_clients():
            await client.aclose()
        reset_llm_client()
        logger.info("service stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.app.log_level, settings.app.log_format)

    _app = FastAPI(
        title="EGE Math Part 2 Grading Service",
        description=DESCRIPTION,
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.app.is_prod else "/docs",
        redoc_url=None,
        openapi_url=None if settings.app.is_prod else "/openapi.json",
    )
    _app.state.settings = settings

    _app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.app.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @_app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[JSONResponse]]
    ):
        request_id = request.headers.get("X-Request-ID") or new_id()
        set_request_id(request_id)
        started = time.perf_counter()

        response = await call_next(request)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "%s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": elapsed_ms,
            },
        )
        return response

    @_app.exception_handler(ServiceError)
    async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
        payload = exc.to_payload()
        payload["request_id"] = get_request_id()
        if exc.status_code >= 500:
            logger.error("service error: %s", exc.message, extra={"code": exc.code})
        else:
            logger.info("service error: %s", exc.message, extra={"code": exc.code})
        return JSONResponse(status_code=exc.status_code, content=payload)

    @_app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "request_validation_error",
                    "message": "тело запроса не прошло валидацию",
                    "details": {"errors": exc.errors()},
                },
                "request_id": get_request_id(),
            },
        )

    @_app.exception_handler(Exception)
    async def unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error")
        message = str(exc) if not settings.app.is_prod else "internal server error"
        return JSONResponse(
            status_code=500,
            content={
                "error": {"code": "internal_error", "message": message, "details": {}},
                "request_id": get_request_id(),
            },
        )

    _app.include_router(routes_health.router)
    _app.include_router(routes_grading.router)
    _app.include_router(routes_photo.router)
    if settings.debug.enabled:
        _app.include_router(routes_debug.router)

    static_dir = Path(__file__).parent / "static"
    if static_dir.is_dir():
        _app.mount("/ui", StaticFiles(directory=static_dir, html=True), name="ui")

        @_app.get("/", include_in_schema=False)
        async def root() -> RedirectResponse:
            return RedirectResponse("/ui/")

    return _app


app = create_app()
