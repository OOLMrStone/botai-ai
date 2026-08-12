"""Make a model verdict safe to return.

A language model will occasionally award 5 points out of 4, or call a
zero-score answer "correct".  None of that should reach a student, and none of
it should be a 500 either.  Everything here corrects silently-but-loudly: the
value is fixed, and a note is appended so `meta.notes` shows what happened.
"""

from __future__ import annotations

import logging
import statistics

from app.domain.schemas import LLMVerdict, Verdict
from app.domain.stages import DualGradeResult
from app.domain.tasks import Criterion

logger = logging.getLogger(__name__)


def normalise(
    verdict: LLMVerdict,
    *,
    max_score: int,
    criteria: list[Criterion],
) -> tuple[LLMVerdict, list[str]]:
    notes: list[str] = []
    data = verdict.model_copy(deep=True)

    data.max_score = max_score

    clamped = max(0, min(max_score, data.score))
    if clamped != data.score:
        notes.append(f"score {data.score} вне диапазона 0..{max_score}, приведён к {clamped}")
        data.score = clamped

    allowed = sorted({c.points for c in criteria if 0 <= c.points <= max_score})
    if allowed and data.score not in allowed:
        snapped = min(allowed, key=lambda p: (abs(p - data.score), p))
        notes.append(f"score {data.score} отсутствует в критериях {allowed}, приведён к {snapped}")
        data.score = snapped

    expected = _verdict_for(data.score, max_score, data.verdict)
    if expected != data.verdict:
        notes.append(f"verdict {data.verdict!r} не согласован с баллом {data.score}, заменён на {expected!r}")
        data.verdict = expected

    if not 0.0 <= data.confidence <= 1.0:
        notes.append(f"confidence {data.confidence} вне [0;1], приведена к границе")
        data.confidence = max(0.0, min(1.0, data.confidence))

    if not data.criterion_matched.strip():
        match = next((c.description for c in criteria if c.points == data.score), "")
        data.criterion_matched = match
        notes.append("criterion_matched пуст, подставлен критерий по баллу")

    if notes:
        logger.warning("verdict normalised", extra={"corrections": notes})
    return data, notes


def _verdict_for(score: int, max_score: int, current: Verdict) -> Verdict:
    if current == "not_a_solution" and score == 0:
        return current  # the model made a stronger claim than "just wrong"
    if score >= max_score:
        return "correct"
    if score <= 0:
        return "incorrect"
    return "partially_correct"


def normalise_grades(
    result: DualGradeResult, *, max_score: int, allowed: list[int]
) -> tuple[DualGradeResult, list[str]]:
    """Clamp both grades and enforce `base >= presentation`.

    The ordering is a statement about the world, not a formatting preference:
    presentation can only cost a student points they had already earned with
    the mathematics, never win new ones. A presentation grade above the base
    one would mean writing something up neatly had improved the maths.

    Unlike the old three-persona sort, the two are *not* swapped when they
    come back inverted. Swapping would silently invent a story — "you earned
    less than you defended" — and the grades carry prose that would then
    contradict the numbers. Instead the base is raised to meet the
    presentation grade: the model demonstrably found that many points
    defensible under the criteria, so they were earned, and the mistake was
    in the base. The correction is reported either way.
    """
    notes: list[str] = []
    data = result.model_copy(deep=True)

    labels = {"base": "базовая", "presentation": "с учётом оформления"}
    for name, label in labels.items():
        grade = getattr(data, name)
        clamped = max(0, min(max_score, grade.score))
        if clamped != grade.score:
            notes.append(f"{label}: балл {grade.score} вне 0..{max_score}, приведён к {clamped}")
            grade.score = clamped
        if allowed and grade.score not in allowed:
            snapped = min(allowed, key=lambda p: (abs(p - grade.score), p))
            notes.append(
                f"{label}: балл {grade.score} отсутствует в критериях {allowed}, "
                f"приведён к {snapped}"
            )
            grade.score = snapped

    if data.presentation.score > data.base.score:
        notes.append(
            f"оценка с учётом оформления ({data.presentation.score}) выше базовой "
            f"({data.base.score}), чего быть не может; базовая поднята до "
            f"{data.presentation.score}"
        )
        data.base.score = data.presentation.score

    gap = data.base.score - data.presentation.score
    if data.points_at_risk != gap:
        notes.append(f"points_at_risk={data.points_at_risk} не сходится с разностью, стало {gap}")
        data.points_at_risk = gap

    if not 0.0 <= data.confidence <= 1.0:
        data.confidence = max(0.0, min(1.0, data.confidence))
        notes.append("confidence вне [0;1], приведена к границе")

    if notes:
        logger.warning("grades normalised", extra={"corrections": notes})
    return data, notes


def consensus(verdicts: list[LLMVerdict]) -> tuple[LLMVerdict, list[int], list[str]]:
    """Reduce N independent gradings to one.

    Median score, then the sample that actually scored the median supplies the
    narrative -- averaging prose would produce mush.  Wide spread is surfaced
    as a note and as reduced confidence, because that is exactly the case a
    human should look at.
    """
    scores = [v.score for v in verdicts]
    if len(verdicts) == 1:
        return verdicts[0], scores, []

    median = int(statistics.median_low(scores))
    chosen = next(v for v in verdicts if v.score == median)
    notes: list[str] = []

    spread = max(scores) - min(scores)
    if spread:
        notes.append(f"оценки {len(scores)} прогонов разошлись: {scores}, взята медиана {median}")
        chosen = chosen.model_copy(update={"confidence": round(chosen.confidence * (1 / (1 + spread)), 2)})

    return chosen, scores, notes
