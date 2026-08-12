"""Grading orchestration: request -> prompt -> model -> validated verdict."""

from __future__ import annotations

import asyncio
import logging

from app.config import Settings, get_settings
from app.core.context import new_id
from app.core.errors import ServiceError, ValidationError
from app.domain.schemas import (
    AnswerCheck,
    BatchGradeRequest,
    BatchGradeResponse,
    BatchItemResult,
    GradeDebugInfo,
    GradeRequest,
    GradeResponse,
    GradingMeta,
    LLMVerdict,
)
from app.domain.tasks import CRITERIA_SOURCE, Criterion, TaskSpec, get_task_spec
from app.grading import prompts
from app.grading.postprocess import consensus, normalise
from app.llm import LLMClient, get_llm_client
from app.llm.types import Message, Usage

logger = logging.getLogger(__name__)


class GradingService:
    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm = llm
        self.settings = settings

    # -- helpers used by both the API and the debug endpoints ------------
    def resolve(self, request: GradeRequest) -> tuple[TaskSpec, list[Criterion], int]:
        spec = get_task_spec(request.task_number)
        criteria = request.criteria_override or spec.criteria
        max_score = request.max_score if request.max_score is not None else spec.max_score

        if max_score <= 0:
            raise ValidationError("max_score должен быть положительным", details={"max_score": max_score})
        if request.criteria_override is not None and not request.criteria_override:
            raise ValidationError("criteria_override не может быть пустым списком")

        over = [c.points for c in criteria if c.points > max_score]
        if over:
            raise ValidationError(
                "в критериях есть баллы выше максимального",
                details={"max_score": max_score, "offending": over},
            )
        return spec, criteria, max_score

    def build_prompt(self, request: GradeRequest) -> list[Message]:
        spec, criteria, max_score = self.resolve(request)
        return prompts.build_messages(request, spec, criteria, max_score)

    @property
    def debug_enabled(self) -> bool:
        return self.settings.debug.enabled

    # -- main entry point -------------------------------------------------
    async def grade(self, request: GradeRequest) -> GradeResponse:
        request_id = new_id("grade")
        spec, criteria, max_score = self.resolve(request)
        debug_options = request.debug if self.debug_enabled else None

        if debug_options and debug_options.force_score is not None:
            return self._forced(request_id, request, spec, criteria, max_score, debug_options.force_score)

        messages = prompts.build_messages(request, spec, criteria, max_score)
        samples = max(1, self.settings.grading.self_consistency)

        logger.info(
            "grading",
            extra={
                "grade_request_id": request_id,
                "task_number": spec.number,
                "max_score": max_score,
                "samples": samples,
                "student_id": request.student_id,
            },
        )

        results = await asyncio.gather(
            *(
                self.llm.complete_structured(
                    messages=messages,
                    schema=LLMVerdict,
                    schema_name="EGEVerdict",
                    seed=debug_options.seed if debug_options else None,
                )
                for _ in range(samples)
            )
        )

        chosen, sample_scores, consensus_notes = consensus([r.value for r in results])
        verdict, fix_notes = normalise(chosen, max_score=max_score, criteria=criteria)

        usage = Usage()
        for result in results:
            usage = usage + result.meta.usage
        head = results[0].meta

        meta = GradingMeta(
            provider=head.provider,
            model=head.model,
            mocked=head.mocked,
            usage=usage,
            latency_ms=max(r.meta.latency_ms for r in results),
            attempts=sum(r.meta.attempts for r in results),
            structured_mode=head.structured_mode,
            samples=samples,
            trace_ids=[r.meta.trace_id for r in results],
            notes=[*consensus_notes, *fix_notes, *head.notes],
        )

        debug_info = None
        if debug_options and (debug_options.return_prompt or debug_options.return_raw):
            debug_info = GradeDebugInfo(
                prompt=prompts.render(messages) if debug_options.return_prompt else None,
                raw_response=results[0].raw_text if debug_options.return_raw else None,
                sample_scores=sample_scores,
                criteria_source=None if request.criteria_override else CRITERIA_SOURCE,
            )

        return _to_response(request_id, spec, verdict, max_score, meta, debug_info)

    async def grade_batch(self, batch: BatchGradeRequest) -> BatchGradeResponse:
        limit = self.settings.grading.batch_limit
        if len(batch.items) > limit:
            raise ValidationError(
                f"в пакете не больше {limit} работ",
                details={"received": len(batch.items), "limit": limit},
            )

        request_id = new_id("batch")

        async def run(index: int, item: GradeRequest) -> BatchItemResult:
            try:
                return BatchItemResult(index=index, ok=True, result=await self.grade(item))
            except ServiceError as exc:
                return BatchItemResult(index=index, ok=False, error=exc.to_payload()["error"])
            except Exception as exc:  # noqa: BLE001 - one bad item must not sink the batch
                logger.exception("batch item failed", extra={"index": index})
                return BatchItemResult(
                    index=index,
                    ok=False,
                    error={"code": "internal_error", "message": str(exc), "details": {}},
                )

        items = await asyncio.gather(*(run(i, item) for i, item in enumerate(batch.items)))
        succeeded = sum(1 for i in items if i.ok)
        return BatchGradeResponse(
            request_id=request_id,
            total=len(items),
            succeeded=succeeded,
            failed=len(items) - succeeded,
            items=list(items),
        )

    # -- debug backdoor ---------------------------------------------------
    def _forced(
        self,
        request_id: str,
        request: GradeRequest,
        spec: TaskSpec,
        criteria: list[Criterion],
        max_score: int,
        forced_score: int,
    ) -> GradeResponse:
        """Return a fabricated verdict without touching the model.

        For frontend work and load tests: deterministic, instant, free.  Guarded
        by the debug toolkit -- `request.debug` is dropped before we get here
        when the toolkit is off.
        """
        score = max(0, min(max_score, forced_score))
        matched = next((c.description for c in criteria if c.points == score), "")
        verdict, notes = normalise(
            LLMVerdict(
                score=score,
                max_score=max_score,
                criterion_matched=matched,
                verdict="correct" if score >= max_score else ("incorrect" if score == 0 else "partially_correct"),
                summary=f"[DEBUG] Балл {score} из {max_score} выставлен принудительно, модель не вызывалась.",
                strengths=[],
                errors=[],
                missing_justifications=[],
                student_answer="",
                expected_answer=request.reference_answer or "",
                answer_matches=score >= max_score,
                confidence=1.0,
            ),
            max_score=max_score,
            criteria=criteria,
        )
        logger.warning(
            "returning forced grade (debug toolkit)",
            extra={"grade_request_id": request_id, "forced_score": score},
        )
        meta = GradingMeta(
            provider="debug",
            model="forced",
            mocked=True,
            samples=0,
            notes=["debug.force_score: модель не вызывалась", *notes],
        )
        return _to_response(
            request_id,
            spec,
            verdict,
            max_score,
            meta,
            GradeDebugInfo(forced=True, sample_scores=[score]),
        )


def _to_response(
    request_id: str,
    spec: TaskSpec,
    verdict: LLMVerdict,
    max_score: int,
    meta: GradingMeta,
    debug: GradeDebugInfo | None,
) -> GradeResponse:
    return GradeResponse(
        request_id=request_id,
        task_number=spec.number,
        topic=spec.topic,
        topic_ru=spec.topic_ru,
        score=verdict.score,
        max_score=max_score,
        verdict=verdict.verdict,
        criterion_matched=verdict.criterion_matched,
        summary=verdict.summary,
        strengths=verdict.strengths,
        errors=verdict.errors,
        missing_justifications=verdict.missing_justifications,
        answer_check=AnswerCheck(
            student_answer=verdict.student_answer or None,
            expected_answer=verdict.expected_answer or None,
            matches=verdict.answer_matches,
        ),
        confidence=verdict.confidence,
        meta=meta,
        debug=debug,
    )


_service: GradingService | None = None


def get_grading_service() -> GradingService:
    global _service
    if _service is None:
        _service = GradingService(get_llm_client(), get_settings())
    return _service


def reset_grading_service() -> None:
    global _service
    _service = None
