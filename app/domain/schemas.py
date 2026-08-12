"""Wire contracts.

Two families of models that deliberately stay separate:

* `LLMVerdict` and friends -- what the *model* is asked to produce.  Kept free
  of numeric constraints because strict structured output ignores `minimum`/
  `maximum`; the bounds are enforced afterwards in `grading/postprocess.py`.
* `GradeResponse` -- what the *API* returns, after clamping and enrichment.

Keeping them apart means a model that hallucinates `score: 9` produces a
clean, logged correction rather than a 500.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.stages import AnalysisResult, Grade, ReconstructionResult
from app.domain.tasks import Criterion
from app.llm.pricing import CostBreakdown
from app.llm.pricing import total as total_cost
from app.llm.types import Usage

Verdict = Literal["correct", "partially_correct", "incorrect", "not_a_solution"]
Severity = Literal["critical", "major", "minor"]


# --------------------------------------------------------------------------
# what the model returns
# --------------------------------------------------------------------------
class SolutionError(BaseModel):
    severity: Severity = Field(description="critical — обнуляет пункт; major — теряет балл; minor — не влияет")
    where: str = Field(description="Где именно: пункт, номер шага или цитата из решения")
    description: str = Field(description="В чём ошибка")
    how_to_fix: str = Field(description="Что нужно было сделать")


class LLMVerdict(BaseModel):
    """The structured judgement requested from the model."""

    score: int = Field(description="Выставленный балл")
    max_score: int = Field(description="Максимальный балл за задание")
    criterion_matched: str = Field(description="Дословная формулировка сработавшего критерия")
    verdict: Verdict
    summary: str = Field(description="2-4 предложения для ученика, по-русски")
    strengths: list[str] = Field(description="Что сделано верно")
    errors: list[SolutionError]
    missing_justifications: list[str] = Field(description="Пропущенные обоснования и шаги")
    student_answer: str = Field(description="Итоговый ответ ученика, как он записан; пустая строка если не найден")
    expected_answer: str = Field(description="Верный ответ; пустая строка если неизвестен")
    answer_matches: bool
    confidence: float = Field(description="Уверенность проверки от 0 до 1")


# --------------------------------------------------------------------------
# request
# --------------------------------------------------------------------------
class GradeOptions(BaseModel):
    detail_level: Literal["brief", "full"] = "full"
    language: Literal["ru", "en"] = "ru"


class DebugOptions(BaseModel):
    """Per-request debug levers. Ignored entirely unless the debug toolkit is on.

    See docs/DEBUG_TOOLKIT.md -- these are the same switches the `/debug`
    endpoints use, exposed inline so a frontend can drive them without a
    second call.
    """

    force_score: int | None = Field(default=None, description="Пропустить LLM и вернуть этот балл")
    return_prompt: bool = Field(default=False, description="Вложить отправленный промпт в ответ")
    return_raw: bool = Field(default=False, description="Вложить сырой текст ответа модели")
    seed: int | None = Field(default=None, description="Seed, если провайдер его поддерживает")


class GradeRequest(BaseModel):
    task_number: int = Field(description="Номер задания второй части: 13-19", examples=[13])
    statement: str = Field(min_length=1, description="Условие задачи")
    student_solution: str = Field(min_length=1, description="Решение ученика (текст / LaTeX)")

    reference_solution: str | None = Field(
        default=None, description="Эталонное решение, если есть — заметно повышает точность"
    )
    reference_answer: str | None = Field(default=None, description="Верный ответ, если известен")
    criteria_override: list[Criterion] | None = Field(
        default=None,
        description="Точные критерии ФИПИ для этой задачи. Приоритетнее реестра.",
    )
    max_score: int | None = Field(default=None, description="Переопределение максимального балла")

    student_id: str | None = Field(default=None, description="Сквозной идентификатор для логов")
    options: GradeOptions = Field(default_factory=GradeOptions)
    debug: DebugOptions | None = None


class BatchGradeRequest(BaseModel):
    items: list[GradeRequest] = Field(min_length=1)


# --------------------------------------------------------------------------
# response
# --------------------------------------------------------------------------
class AnswerCheck(BaseModel):
    student_answer: str | None = None
    expected_answer: str | None = None
    matches: bool | None = None


class GradingMeta(BaseModel):
    model_config = {"protected_namespaces": ()}

    provider: str
    model: str
    mocked: bool = False
    usage: Usage = Field(default_factory=Usage)
    latency_ms: int = 0
    attempts: int = 1
    structured_mode: str | None = None
    samples: int = Field(default=1, description="Сколько независимых проверок усреднено")
    trace_ids: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class GradeDebugInfo(BaseModel):
    prompt: list[dict[str, str]] | None = None
    raw_response: str | None = None
    forced: bool = False
    sample_scores: list[int] = Field(default_factory=list)
    criteria_source: str | None = None


class GradeResponse(BaseModel):
    request_id: str
    task_number: int
    topic: str
    topic_ru: str

    score: int
    max_score: int
    verdict: Verdict
    criterion_matched: str

    summary: str
    strengths: list[str] = Field(default_factory=list)
    errors: list[SolutionError] = Field(default_factory=list)
    missing_justifications: list[str] = Field(default_factory=list)
    answer_check: AnswerCheck = Field(default_factory=AnswerCheck)
    confidence: float = 0.0

    meta: GradingMeta
    debug: GradeDebugInfo | None = None


# --------------------------------------------------------------------------
# photo pipeline (stages 1–3)
# --------------------------------------------------------------------------
class PhotoGradeRequest(BaseModel):
    task_number: int = Field(description="Номер задания второй части: 13–19")
    statement: str = Field(min_length=1, description="Условие задачи")

    images: list[str] = Field(
        default_factory=list,
        max_length=6,
        description="Фотографии решения: data:-URL с base64 или https-ссылки",
    )
    solution_text: str | None = Field(
        default=None,
        description=(
            "Готовый текст решения. Если задан — этап 1 (распознавание) пропускается. "
            "Путь для случая, когда vision-модель не настроена, и для экрана "
            "«вот что мы прочитали, исправь»."
        ),
    )

    reference_solution: str | None = None
    reference_answer: str | None = None
    criteria_override: str | None = Field(
        default=None, description="Точные критерии ФИПИ для этой задачи (markdown)"
    )
    max_score: int | None = None
    student_id: str | None = None
    features: dict[str, bool] | None = Field(
        default=None,
        description=(
            "Переопределение feature-флагов для этого запроса. См. GET /debug/features. "
            "Нужно для бенчмарка: тот же снимок, один флаг иначе, два отчёта для сравнения."
        ),
    )

    @model_validator(mode="after")
    def _needs_a_solution(self) -> PhotoGradeRequest:
        if not self.images and not (self.solution_text or "").strip():
            raise ValueError("нужны либо images, либо solution_text")
        return self


class StageMeta(BaseModel):
    model_config = {"protected_namespaces": ()}

    stage: Literal["reconstruction", "analysis", "grading"]
    provider: str
    model: str
    mocked: bool = False
    usage: Usage = Field(default_factory=Usage)
    latency_ms: int = 0
    attempts: int = 1
    structured_mode: str | None = None
    trace_id: str
    notes: list[str] = Field(default_factory=list)
    # None when the model is not in the rate table and the provider reported
    # nothing. `cost.source` says whether this is a charge or an estimate.
    cost: CostBreakdown = Field(default_factory=CostBreakdown)


class PhotoGradeResponse(BaseModel):
    request_id: str
    task_number: int
    topic_ru: str
    max_score: int

    base: Grade = Field(description="Сколько заработано математикой")
    presentation: Grade = Field(description="Сколько из этого защищено оформлением")
    points_at_risk: int = Field(
        description="Заработано, но не защищено: базовая − с учётом оформления"
    )

    summary: str
    risk_comment: str
    how_to_protect_points: str
    how_to_raise_base: str
    confidence: float

    reconstruction: ReconstructionResult | None = None
    analysis: AnalysisResult | None = None

    stages: list[StageMeta] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    features: dict[str, bool] = Field(
        default_factory=dict, description="Флаги, действовавшие при этой проверке"
    )

    @property
    def total_usage(self) -> Usage:
        total = Usage()
        for stage in self.stages:
            total = total + stage.usage
        return total

    @property
    def total_cost(self) -> CostBreakdown:
        return total_cost([stage.cost for stage in self.stages])


class BatchItemResult(BaseModel):
    index: int
    ok: bool
    result: GradeResponse | None = None
    error: dict[str, object] | None = None


class BatchGradeResponse(BaseModel):
    request_id: str
    total: int
    succeeded: int
    failed: int
    items: list[BatchItemResult]
