"""Grading of a photographed solution, in two or three stages.

    photo ──stage 1 (vision)──▶ transcript ──stage 2 (text)──▶ findings
                                                                  │
                                            two grades ◀──stage 3 (text)

Normally only stage 1 sees the image, and stages 2 and 3 work from the
transcript — which is why `DrawingDescription` exists: for planimetry and
stereometry the argument lives in the figure, so stage 1 renders the figure as
structured text and that text carries the geometry forward.

Two things shorten that chain, and they arrive from opposite directions:

* `solution_text` on the request means there is no photograph to read. Not
  only a test hook — it is the supported path when no vision-capable endpoint
  is configured, and the path a "this is what we read, correct it" screen uses.
* the `reconstruct_first` toggle, off, means there *is* a photograph and we
  deliberately decline to transcribe it first: the image goes to stage 2,
  which reads the handwriting and finds the errors in one pass. The test
  session put most of the score-affecting damage on photographs inside stage
  1's reading, and a misread digit is never revisited afterwards — so the
  toggle exists to measure the pipeline against its own recognition step.

Either way stage 2 receives the work and stage 3 grades the findings; only the
source of the work changes. See invariant 8 in CLAUDE.md for why this one
toggle is allowed to move a stage rather than a paragraph.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from app.config import Settings, get_settings
from app.core.context import new_id
from app.core.errors import ServiceError, ValidationError
from app.domain.schemas import PhotoGradeRequest, PhotoGradeResponse, StageMeta
from app.domain.stages import AnalysisResult, DualGradeResult, ReconstructionResult
from app.domain.tasks import TaskSpec, get_task_spec
from app.features import FEATURES, non_default, request_extra_for, resolve as resolve_features
from app.grading.postprocess import normalise_grades
from app.llm import LLMClient, Message, get_llm_client
from app.llm.pricing import CostBreakdown, ModelRate, load_rates, price
from app.llm.types import CallMeta
from app.prompting import PromptLibrary, get_prompt_library
from app.reporting import ReportBuilder, get_report_store

logger = logging.getLogger(__name__)

# (event name, payload) -> awaited by the caller. `run` is fully usable with
# emit=None; streaming is an observer, never a requirement.
Emit = Callable[[str, dict[str, Any]], Awaitable[None]]

STAGE_LABELS = {
    "reconstruction": "Этап 1 — распознавание рукописи",
    "analysis": "Этап 2 — поиск ошибок",
    "grading": "Этап 3 — две оценки",
}
# Shown instead of the above when stage 1 is switched off and this stage is the
# one holding the photograph.
ANALYSIS_ON_PHOTO_LABEL = "Этап 2 — чтение фото и поиск ошибок"

# Toggles that only ever gate stage 1's template. Read from the registry rather
# than listed here: with stage 1 switched off they quietly do nothing, and a
# benchmark that does not say so reports a comparison it never ran.
STAGE1_ONLY_FEATURES = tuple(
    f.key for f in FEATURES if f.stages == ("stage1_reconstruction",)
)


async def _noop(event: str, payload: dict[str, Any]) -> None:
    return None


class PhotoGradingPipeline:
    def __init__(
        self,
        vision_client: LLMClient,
        text_client: LLMClient,
        library: PromptLibrary,
        settings: Settings,
    ) -> None:
        self.vision = vision_client
        self.text = text_client
        self.library = library
        self.settings = settings
        self.rates = load_rates(settings.llm.pricing)

    # -- rubric resolution ------------------------------------------------
    def resolve(self, request: PhotoGradeRequest) -> tuple[TaskSpec, str, str, int]:
        """→ (spec, criteria text, pitfalls text, max_score)."""
        spec = get_task_spec(request.task_number)
        criteria_file = self.library.criteria(request.task_number)

        if request.criteria_override:
            criteria = request.criteria_override
        else:
            criteria = criteria_file.section("Критерии")

        pitfalls = criteria_file.section("Типичные потери баллов")
        max_score = request.max_score or int(criteria_file.meta.get("max_score", spec.max_score))
        if max_score <= 0:
            raise ValidationError("max_score должен быть положительным")
        return spec, criteria, pitfalls, max_score

    # -- stages -----------------------------------------------------------
    async def reconstruct(
        self, request: PhotoGradeRequest, spec: TaskSpec, features: dict[str, bool]
    ) -> tuple[ReconstructionResult, CallMeta, str]:
        prompt = self.library.get("stage1_reconstruction").render(
            features=features,
            task_number=spec.number,
            task_topic=spec.topic_ru,
            statement=request.statement,
        )
        result = await self.vision.complete_structured(
            messages=[Message.user_with_images(prompt, request.images)],
            schema=ReconstructionResult,
            schema_name="Reconstruction",
            extra_body=request_extra_for("stage1_reconstruction", features),
        )
        return result.value, result.meta, prompt

    async def analyse(
        self,
        request: PhotoGradeRequest,
        spec: TaskSpec,
        pitfalls: str,
        transcript: str,
        features: dict[str, bool],
        images: list[str] | None = None,
    ) -> tuple[AnalysisResult, CallMeta, str]:
        """Findings from the work — either a transcript or the photograph itself.

        `images` non-empty means stage 1 was switched off, so this call carries
        the photograph and goes to the vision client. The template branches on
        the same toggle, so the prompt asks for the reading as well as the
        analysis; `transcript` is then empty and unused.
        """
        reference = ""
        if request.reference_solution:
            reference = f"## Эталонное решение\n{request.reference_solution}\n"
        if request.reference_answer:
            reference += f"\n## Верный ответ\n{request.reference_answer}\n"

        prompt = self.library.get("stage2_analysis").render(
            features=features,
            task_number=spec.number,
            task_topic=spec.topic_ru,
            statement=request.statement,
            reconstruction=transcript,
            task_pitfalls=pitfalls,
            reference_block=reference,
        )
        stage_extra = request_extra_for("stage2_analysis", features)
        if images:
            client = self.vision
            message = Message.user_with_images(prompt, images)
            budget, extra = self._borrowed_vision_profile(stage_extra)
        else:
            client = self.text
            message = Message.user(prompt)
            budget, extra = None, stage_extra

        result = await client.complete_structured(
            messages=[message],
            schema=AnalysisResult,
            schema_name="Analysis",
            max_output_tokens=budget,
            extra_body=extra,
        )
        return result.value, result.meta, prompt

    def _borrowed_vision_profile(
        self, stage_extra: dict[str, Any] | None
    ) -> tuple[int, dict[str, Any]]:
        """Budget and vendor body for a stage 2 that runs on the vision client.

        The vision client's settings are *stage 1's* profile: a small output
        budget and thinking switched off, both correct for transcription and
        both wrong here. This call reads the sheet **and** analyses it, so it
        needs what stage 2 normally gets. Only the endpoint is borrowed.

        Without this, `LLM_VISION_MAX_OUTPUT_TOKENS` (tuned down precisely
        because stage 1 does not reason) truncates the call mid-thought, and
        `LLM_VISION_EXTRA_BODY={"thinking":{"type":"disabled"}}` silently
        disables the reasoning that finding a lost root depends on — which
        would make this mode look worse for a reason unrelated to recognition.
        """
        text = self.text.settings
        vision = self.vision.settings
        # `None` deletes a key from the merged body (RFC 7396 semantics in
        # LLMClient._build_request): drop whatever stage 1's profile sets that
        # stage 2's does not ask for.
        extra: dict[str, Any] = {
            key: None for key in (vision.extra_body or {}) if key not in (text.extra_body or {})
        }
        extra.update(text.extra_body or {})
        extra.update(stage_extra or {})
        return text.max_output_tokens, extra

    async def grade(
        self,
        spec: TaskSpec,
        criteria: str,
        max_score: int,
        analysis: AnalysisResult,
        features: dict[str, bool],
    ) -> tuple[DualGradeResult, CallMeta, str]:
        prompt = self.library.get("stage3_grading").render(
            features=features,
            task_number=spec.number,
            max_score=max_score,
            criteria=criteria,
            findings=analysis.findings_text(),
            analysis_summary=analysis.summary_text(),
        )
        result = await self.text.complete_structured(
            messages=[Message.user(prompt)],
            schema=DualGradeResult,
            schema_name="DualGrade",
            extra_body=request_extra_for("stage3_grading", features),
        )
        return result.value, result.meta, prompt

    # -- orchestration ----------------------------------------------------
    async def run(
        self, request: PhotoGradeRequest, emit: Emit | None = None
    ) -> PhotoGradeResponse:
        base_say = emit or _noop
        # Minted here, before anything can fail. Resolving the task or the
        # feature flags can raise, and a report built after that used to fall
        # back to the literal id "unknown" — so every early failure collided
        # in the store and none could be fetched by id. Failed runs are
        # exactly the ones someone files a report about.
        request_id = new_id("grade")
        report = ReportBuilder(request, self.settings, self.library, request_id=request_id)

        async def say(event: str, payload: dict[str, Any]) -> None:
            report.observe(event, payload)
            await base_say(event, payload)

        try:
            return await self._run(request, say, report, request_id)
        except ServiceError as exc:
            # A failed run is the one someone actually files a report about,
            # so it is stored too — with whichever stages did complete.
            report.failed(exc.code, str(exc))
            await self._finalise_report(say, report, None)
            raise
        except Exception as exc:
            report.failed("internal_error", str(exc))
            await self._finalise_report(say, report, None)
            raise

    async def _run(
        self,
        request: PhotoGradeRequest,
        say: Emit,
        report: ReportBuilder,
        request_id: str,
    ) -> PhotoGradeResponse:
        spec, criteria, pitfalls, max_score = self.resolve(request)
        features = resolve_features(
            configured=self.settings.features.features, override=request.features
        )
        stages: list[StageMeta] = []
        notes: list[str] = []

        # Only the deviations, so a benchmark report says what it was testing
        # rather than restating the whole registry.
        changed = non_default(features)
        if changed:
            notes.append(
                "нестандартные флаги: "
                + ", ".join(f"{k}={'вкл' if v else 'выкл'}" for k, v in sorted(changed.items()))
            )

        # Stage 1 runs only when there is a photograph to read *and* we still
        # want it read separately.
        read_photo_separately = bool(request.images) and not request.solution_text
        if not features["reconstruct_first"]:
            read_photo_separately = False
        total = 3 if read_photo_separately else 2
        await say(
            "started",
            {
                "request_id": request_id,
                "task_number": spec.number,
                "topic_ru": spec.topic_ru,
                "max_score": max_score,
                "total_stages": total,
                "images": len(request.images),
                "features": features,
                "features_changed": changed,
            },
        )

        logger.info(
            "pipeline start",
            extra={
                "grade_request_id": request_id,
                "task_number": spec.number,
                "images": len(request.images),
                "text_supplied": bool(request.solution_text),
            },
        )

        # ---- stage 1
        reconstruction: ReconstructionResult | None = None
        # Non-empty only when stage 2 is the one holding the photograph.
        analysis_images: list[str] = []
        index = 0
        if request.solution_text:
            transcript = request.solution_text
            notes.append("этап 1 пропущен: решение передано текстом")
            await say("stage_skipped", {"stage": "reconstruction", "reason": "решение передано текстом"})
        elif not read_photo_separately:
            # The toggle is off: hand the photograph to stage 2 instead of a
            # transcript of it.
            transcript = ""
            analysis_images = request.images
            notes.append(
                "этап 1 выключен флагом reconstruct_first: фотография разбирается напрямую"
            )
            inert = [k for k in STAGE1_ONLY_FEATURES if k in features]
            if inert:
                notes.append("флаги этапа 1 в этом режиме не действуют: " + ", ".join(inert))
            await say(
                "stage_skipped",
                {
                    "stage": "reconstruction",
                    "reason": "флаг reconstruct_first выключен: фотография уходит прямо на разбор",
                },
            )
        else:
            index += 1
            started = time.perf_counter()
            await self._announce(say, "reconstruction", index, total, self.vision)
            reconstruction, meta, prompt = await self.reconstruct(request, spec, features)
            stage = _stage_meta("reconstruction", meta, started, self.rates)
            stages.append(stage)
            await self._finished(say, stage, index, total, prompt, reconstruction, report)

            if not reconstruction.is_solution_present:
                response = _empty_response(request_id, spec, max_score, reconstruction, stages)
                await say("result", response.model_dump(mode="json"))
                return response

            transcript = reconstruction.to_prompt_text()
            if reconstruction.suspicious_content:
                notes.append(
                    "на фото обнаружен текст, адресованный проверяющей системе; "
                    "он проигнорирован: " + "; ".join(reconstruction.suspicious_content)[:300]
                )
                logger.warning(
                    "prompt-injection attempt in submitted photo",
                    extra={"grade_request_id": request_id},
                )

        # ---- stage 2
        index += 1
        started = time.perf_counter()
        await self._announce(
            say,
            "analysis",
            index,
            total,
            self.vision if analysis_images else self.text,
            label=ANALYSIS_ON_PHOTO_LABEL if analysis_images else None,
        )
        analysis, meta, prompt = await self.analyse(
            request, spec, pitfalls, transcript, features, images=analysis_images
        )
        stage = _stage_meta("analysis", meta, started, self.rates)
        stages.append(stage)
        await self._finished(
            say,
            stage,
            index,
            total,
            prompt,
            analysis,
            report,
            label=ANALYSIS_ON_PHOTO_LABEL if analysis_images else None,
        )

        # ---- stage 3
        index += 1
        started = time.perf_counter()
        await self._announce(say, "grading", index, total, self.text)
        grades, meta, prompt = await self.grade(spec, criteria, max_score, analysis, features)
        stage = _stage_meta("grading", meta, started, self.rates)
        stages.append(stage)
        await self._finished(say, stage, index, total, prompt, grades, report)

        allowed = _allowed_scores(criteria, max_score)
        grades, fix_notes = normalise_grades(grades, max_score=max_score, allowed=allowed)
        for note in fix_notes:
            await say("log", {"level": "warn", "message": f"постобработка: {note}"})

        response = PhotoGradeResponse(
            request_id=request_id,
            task_number=spec.number,
            topic_ru=spec.topic_ru,
            max_score=max_score,
            base=grades.base,
            presentation=grades.presentation,
            points_at_risk=grades.points_at_risk,
            summary=grades.summary,
            risk_comment=grades.risk_comment,
            how_to_protect_points=grades.how_to_protect_points,
            how_to_raise_base=grades.how_to_raise_base,
            confidence=grades.confidence,
            reconstruction=reconstruction,
            analysis=analysis,
            stages=stages,
            notes=[*notes, *fix_notes],
            features=features,
        )
        await say("result", response.model_dump(mode="json"))
        await self._finalise_report(say, report, response)
        return response

    async def _finalise_report(
        self, say: Emit, report: ReportBuilder, response: PhotoGradeResponse | None
    ) -> None:
        """Store the run and offer it to the caller.

        Always stored, so `/debug/reports` has it after the fact. Emitted only
        when the debug toolkit is on, for the same reason the prompts are —
        the report contains every prompt verbatim.
        """
        try:
            built = report.build(response)
            get_report_store().add(built)
            if self.settings.debug.enabled:
                await say("report", built.model_dump(mode="json"))
        except Exception:  # noqa: BLE001 - a broken report must not void a good grade
            logger.exception("failed to build run report")

    # -- progress reporting -----------------------------------------------
    async def _announce(
        self,
        say: Emit,
        stage: str,
        index: int,
        total: int,
        client: LLMClient,
        label: str | None = None,
    ) -> None:
        await say(
            "stage_start",
            {
                "stage": stage,
                "label": label or STAGE_LABELS[stage],
                "index": index,
                "total": total,
                "model": client.model,
                "provider": client.provider_name,
            },
        )

    async def _finished(
        self,
        say: Emit,
        stage: StageMeta,
        index: int,
        total: int,
        prompt: str,
        value: Any,
        report: ReportBuilder | None = None,
        label: str | None = None,
    ) -> None:
        """Stage result, plus the call detail when the debug toolkit is on.

        Progress, timing, tokens and cost always go out — a caller is entitled
        to know how long its own request took and what it spent.

        The rendered prompt and the parsed output do not. Those are the prompt
        library in full and, through it, the student's work; streaming them to
        every client would put the debug toolkit's most sensitive output on an
        ungated endpoint. With the toolkit off the stream still drives a
        progress bar, and `/debug/reports/{id}` remains the way to get the
        detail — from a build where someone deliberately enabled it.
        """
        payload = stage.model_dump(mode="json")
        payload.update(
            {
                "index": index,
                "total": total,
                "label": label or STAGE_LABELS[stage.stage],
                "prompt": prompt,
                "output": value.model_dump(mode="json"),
            }
        )
        # The report always gets the whole call; it is only ever handed over
        # through the gated endpoint. The stream is what needs trimming.
        if report is not None:
            report.stage_done(payload)
        if not self.settings.debug.enabled:
            payload = {k: v for k, v in payload.items() if k not in ("prompt", "output")}
        await say("stage_done", payload)
        for note in stage.notes:
            await say("log", {"level": "warn", "message": f"{stage.stage}: {note}"})


def _stage_meta(
    name: str,
    meta: CallMeta,
    started: float,
    rates: dict[str, ModelRate] | None = None,
) -> StageMeta:
    return StageMeta(
        stage=name,
        provider=meta.provider,
        model=meta.model,
        mocked=meta.mocked,
        usage=meta.usage,
        latency_ms=int((time.perf_counter() - started) * 1000),
        attempts=meta.attempts,
        structured_mode=meta.structured_mode,
        trace_id=meta.trace_id,
        notes=meta.notes,
        # A mocked call never reached a provider, so it costs nothing —
        # pricing it from the table would put fictional money in the report.
        cost=CostBreakdown(usd=0.0, source="mock", model=meta.model)
        if meta.mocked
        else price(meta.usage, meta.model, rates),
    )


def _allowed_scores(criteria: str, max_score: int) -> list[int]:
    """Point values the rubric text actually mentions.

    Parsed from the criteria markdown rather than the registry, because the
    caller may have supplied their own rubric via `criteria_override`.
    """
    import re

    found = {int(m) for m in re.findall(r"\*\*(\d+)\s*балл", criteria)}
    found = {p for p in found if 0 <= p <= max_score}
    return sorted(found) if found else list(range(max_score + 1))


def _empty_response(
    request_id: str,
    spec: TaskSpec,
    max_score: int,
    reconstruction: ReconstructionResult,
    stages: list[StageMeta],
) -> PhotoGradeResponse:
    """No solution on the photograph — stop, do not spend stages 2 and 3."""
    from app.domain.stages import AnalysisResult, Grade

    zero = Grade(
        score=0,
        criterion_matched="Решение не соответствует ни одному из критериев, перечисленных выше.",
        forgiven=[],
        penalized=[],
        justification="На фотографии не найдено решение задачи.",
    )
    return PhotoGradeResponse(
        request_id=request_id,
        task_number=spec.number,
        topic_ru=spec.topic_ru,
        max_score=max_score,
        base=zero,
        presentation=zero,
        points_at_risk=0,
        summary=(
            "На фотографии не удалось найти решение. Проверь, что снят нужный лист, "
            "что он попал в кадр целиком и что фотография не слишком тёмная."
        ),
        risk_comment="Оформление тут ни при чём: оценивать нечего.",
        how_to_protect_points="—",
        how_to_raise_base="Загрузи фотографию с решением задачи.",
        confidence=reconstruction.overall_legibility,
        reconstruction=reconstruction,
        analysis=AnalysisResult(
            solved_correctly=False,
            method_summary="—",
            correct_answer="—",
            student_answer_correct=False,
            completeness="решение отсутствует",
            blocking_issue="на фотографии нет решения",
            findings=[],
        ),
        stages=stages,
        notes=["этапы 2 и 3 пропущены: решение не найдено"],
    )


_pipeline: PhotoGradingPipeline | None = None


def get_pipeline() -> PhotoGradingPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = PhotoGradingPipeline(
            vision_client=get_llm_client("vision"),
            text_client=get_llm_client("text"),
            library=get_prompt_library(),
            settings=get_settings(),
        )
    return _pipeline


def reset_pipeline() -> None:
    global _pipeline
    _pipeline = None
