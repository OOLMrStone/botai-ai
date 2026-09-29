"""Public grading API."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ServiceDep
from app.domain.schemas import (
    BatchGradeRequest,
    BatchGradeResponse,
    GradeRequest,
    GradeResponse,
)
from app.domain.tasks import (
    CRITERIA_SOURCE,
    PART_TWO_MAX_SCORE,
    PART_TWO_NUMBERS,
    TASK_REGISTRY,
    TaskSpec,
    get_task_spec,
)

router = APIRouter(prefix="/api/v1", tags=["grading"])


@router.post("/grade", response_model=GradeResponse, summary="Проверить одну работу")
async def grade(request: GradeRequest, service: ServiceDep) -> GradeResponse:
    return await service.grade(request)


@router.post("/grade/batch", response_model=BatchGradeResponse, summary="Проверить пакет работ")
async def grade_batch(request: BatchGradeRequest, service: ServiceDep) -> BatchGradeResponse:
    """Graded concurrently. A failing item is reported inline, not as a 5xx."""
    return await service.grade_batch(request)


@router.get("/tasks", summary="Реестр заданий второй части")
async def list_tasks() -> dict[str, object]:
    return {
        "numbers": list(PART_TWO_NUMBERS),
        "part_two_max_score": PART_TWO_MAX_SCORE,
        "criteria_source": CRITERIA_SOURCE,
        "tasks": [spec.model_dump() for spec in TASK_REGISTRY.values()],
    }


@router.get("/tasks/{number}", response_model=TaskSpec, summary="Одно задание с критериями")
async def get_task(number: int) -> TaskSpec:
    return get_task_spec(number)
