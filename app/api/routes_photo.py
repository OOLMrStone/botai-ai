"""Grading a photographed solution through the three-stage pipeline."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.errors import ServiceError, ValidationError
from app.domain.schemas import PhotoGradeRequest, PhotoGradeResponse
from app.api.deps import SettingsDep
from app.core.errors import NotFoundError
from app.features import describe as describe_features
from app.features import resolve as resolve_features
from app.grading.pipeline import get_pipeline
from app.reporting import TesterFeedback, get_report_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["photo grading"])

MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _parse_features(raw: str | None) -> dict[str, bool] | None:
    """`features` arrives as a JSON string on a multipart form.

    A form field cannot carry a typed object, and a malformed one must not be
    ignored: silently discarding it would make a benchmark run report toggles
    it never actually applied.
    """
    if not raw or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"features: ожидался JSON-объект ({exc})") from exc
    if not isinstance(parsed, dict):
        raise ValidationError("features: ожидался JSON-объект вида {\"ключ\": true}")
    return {str(k): bool(v) for k, v in parsed.items()}


async def _collect_images(files: list[UploadFile]) -> list[str]:
    images: list[str] = []
    for upload in files:
        if not upload.filename:
            continue
        payload = await upload.read()
        if not payload:
            continue
        if len(payload) > MAX_IMAGE_BYTES:
            raise ValidationError(
                f"файл {upload.filename} больше {MAX_IMAGE_BYTES // 1024 // 1024} МБ",
                details={"size": len(payload)},
            )
        media_type = upload.content_type or "image/jpeg"
        if media_type not in ALLOWED_TYPES:
            raise ValidationError(
                f"неподдерживаемый тип файла: {media_type}",
                details={"allowed": sorted(ALLOWED_TYPES)},
            )
        encoded = base64.b64encode(payload).decode("ascii")
        images.append(f"data:{media_type};base64,{encoded}")
    return images


@router.post("/grade/photo", response_model=PhotoGradeResponse, summary="Проверить фото решения")
async def grade_photo(request: PhotoGradeRequest) -> PhotoGradeResponse:
    """Images as `data:` URLs or https links.

    Pass `solution_text` instead of `images` to skip recognition and run only
    the analysis and grading stages.
    """
    return await get_pipeline().run(request)


@router.post(
    "/grade/photo/upload",
    response_model=PhotoGradeResponse,
    summary="То же, но multipart-загрузкой файлов",
)
async def grade_photo_upload(
    task_number: Annotated[int, Form()],
    statement: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()] = [],  # noqa: B006 - FastAPI needs the literal
    solution_text: Annotated[str | None, Form()] = None,
    reference_solution: Annotated[str | None, Form()] = None,
    reference_answer: Annotated[str | None, Form()] = None,
    criteria_override: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
) -> PhotoGradeResponse:
    """Convenience wrapper: files in, `data:` URLs out, same pipeline.

    Easier to drive from curl and from a plain HTML form than base64 JSON.
    """
    return await get_pipeline().run(
        PhotoGradeRequest(
            task_number=task_number,
            statement=statement,
            images=await _collect_images(files),
            solution_text=solution_text or None,
            reference_solution=reference_solution or None,
            reference_answer=reference_answer or None,
            criteria_override=criteria_override or None,
            features=_parse_features(features),
        )
    )


@router.post(
    "/grade/photo/stream",
    summary="То же, но с потоком прогресса (SSE)",
    response_class=StreamingResponse,
)
async def grade_photo_stream(
    task_number: Annotated[int, Form()],
    statement: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()] = [],  # noqa: B006 - FastAPI needs the literal
    solution_text: Annotated[str | None, Form()] = None,
    reference_solution: Annotated[str | None, Form()] = None,
    reference_answer: Annotated[str | None, Form()] = None,
    criteria_override: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
) -> StreamingResponse:
    """Server-sent events, one per stage boundary.

    Grading is three sequential model calls and can run for minutes. A plain
    request gives the caller no way to tell "still thinking" from "hung", so
    this endpoint reports each stage as it starts and finishes, carrying the
    prompt that was sent and the object that came back.

    Events: `started`, `stage_start`, `stage_done`, `stage_skipped`, `log`,
    `result`, `error`. The final `result` payload is byte-for-byte what
    `/grade/photo/upload` would have returned.
    """
    request = PhotoGradeRequest(
        task_number=task_number,
        statement=statement,
        images=await _collect_images(files),
        solution_text=solution_text or None,
        reference_solution=reference_solution or None,
        reference_answer=reference_answer or None,
        criteria_override=criteria_override or None,
        features=_parse_features(features),
    )

    async def stream() -> AsyncIterator[str]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

        async def emit(event: str, payload: dict[str, Any]) -> None:
            await queue.put((event, payload))

        async def drive() -> None:
            try:
                await get_pipeline().run(request, emit=emit)
            except ServiceError as exc:
                await queue.put(("error", {"code": exc.code, "message": str(exc)}))
            except Exception as exc:  # noqa: BLE001 - the stream must report, not 500
                logger.exception("photo pipeline failed")
                await queue.put(("error", {"code": "internal_error", "message": str(exc)}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(drive())
        try:
            while True:
                # A comment frame every 15s keeps proxies from closing an idle
                # connection while a slow model is still generating.
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15.0)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                event, payload = item
                yield f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class FeedbackRequest(BaseModel):
    """A tester's verdict on one grading run."""

    verdict: Literal["ok", "wrong", "unsure"] = "unsure"
    comment: str = Field(default="", max_length=4000)
    expected_base: int | None = None
    expected_presentation: int | None = None
    tester: str = Field(default="", max_length=120)


@router.post("/reports/{request_id}/feedback", summary="Сообщить, верна ли оценка")
def submit_feedback(request_id: str, body: FeedbackRequest) -> dict[str, Any]:
    """Attach the tester's verdict to a stored run.

    Deliberately *not* behind the debug gate. A tester's disagreement is the
    entire product of a test round, and it has to be one click away from the
    grade they are looking at — not behind a token they were never given.
    Nothing is read back here, so it exposes no prompts and no other run.
    """
    feedback = TesterFeedback(
        **body.model_dump(),
        submitted_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    report = get_report_store().attach_feedback(request_id, feedback)
    if report is None:
        raise NotFoundError(
            f"нет отчёта {request_id}: возможно, сервис перезапускали",
            details={"request_id": request_id},
        )
    logger.info(
        "tester feedback",
        extra={
            "grade_request_id": request_id,
            "verdict": feedback.verdict,
            "has_comment": bool(feedback.comment),
        },
    )
    return {"ok": True, "request_id": request_id, "verdict": feedback.verdict}


@router.get("/features", summary="Feature-флаги: что можно переключить")
def list_features(settings: SettingsDep) -> dict[str, Any]:
    """The toggle registry, for the panel on the test page.

    Not behind the debug gate, unlike `/debug/features`. This returns names,
    descriptions and defaults — no prompts, no student work, no secrets — and
    *applying* an override has never needed a token either: `features` is an
    ordinary request field. Gating only the listing achieved nothing except
    hiding the panel from the testers the toggles exist for, which is exactly
    what happened on the first deployment.
    """
    return {"features": describe_features(resolve_features(configured=settings.features.features))}
