"""Post-processing: a model cannot hand out impossible grades."""

from __future__ import annotations

import pytest

from app.domain.schemas import LLMVerdict
from app.domain.tasks import get_task_spec
from app.grading.postprocess import consensus, normalise, normalise_grades

SPEC_13 = get_task_spec(13)  # max 2, criteria at 0 / 1 / 2


def verdict(**overrides) -> LLMVerdict:
    base = {
        "score": 1,
        "max_score": 2,
        "criterion_matched": "какой-то критерий",
        "verdict": "partially_correct",
        "summary": "ок",
        "strengths": [],
        "errors": [],
        "missing_justifications": [],
        "student_answer": "",
        "expected_answer": "",
        "answer_matches": False,
        "confidence": 0.8,
    }
    return LLMVerdict(**{**base, **overrides})


def run(v: LLMVerdict):
    return normalise(v, max_score=SPEC_13.max_score, criteria=SPEC_13.criteria)


def test_score_above_maximum_is_clamped():
    result, notes = run(verdict(score=7, verdict="correct"))
    assert result.score == 2
    assert any("вне диапазона" in n for n in notes)


def test_negative_score_is_clamped():
    result, _ = run(verdict(score=-3))
    assert result.score == 0


def test_score_not_present_in_the_rubric_is_snapped():
    spec_18 = get_task_spec(18)
    result, notes = normalise(
        verdict(score=3, max_score=4), max_score=4, criteria=spec_18.criteria
    )
    assert result.score == 3  # 18 does award 3 points

    two_band = [c for c in SPEC_13.criteria if c.points in (0, 2)]
    snapped, notes = normalise(verdict(score=1), max_score=2, criteria=two_band)
    assert snapped.score in (0, 2)
    assert any("отсутствует в критериях" in n for n in notes)


@pytest.mark.parametrize(
    ("score", "expected"),
    [(2, "correct"), (1, "partially_correct"), (0, "incorrect")],
)
def test_verdict_is_realigned_to_the_score(score, expected):
    result, _ = run(verdict(score=score, verdict="correct"))
    assert result.verdict == expected


def test_not_a_solution_survives_at_zero():
    result, _ = run(verdict(score=0, verdict="not_a_solution"))
    assert result.verdict == "not_a_solution"


def test_confidence_is_clamped():
    result, notes = run(verdict(confidence=4.2))
    assert result.confidence == 1.0
    assert any("confidence" in n for n in notes)


def test_empty_criterion_is_backfilled_from_the_score():
    result, _ = run(verdict(score=2, criterion_matched="   "))
    assert "Обоснованно получены верные ответы" in result.criterion_matched


# -- self-consistency -------------------------------------------------------
def test_single_sample_passes_through():
    only = verdict(score=1)
    chosen, scores, notes = consensus([only])
    assert chosen is only
    assert scores == [1]
    assert notes == []


def test_median_wins_and_agreement_keeps_confidence():
    chosen, scores, notes = consensus([verdict(score=2), verdict(score=2), verdict(score=2)])
    assert chosen.score == 2
    assert scores == [2, 2, 2]
    assert notes == []
    assert chosen.confidence == 0.8


def test_disagreement_lowers_confidence_and_is_reported():
    chosen, scores, notes = consensus([verdict(score=0), verdict(score=1), verdict(score=2)])
    assert chosen.score == 1
    assert sorted(scores) == [0, 1, 2]
    assert any("разошлись" in n for n in notes)
    assert chosen.confidence < 0.8


# --- two-grade model ------------------------------------------------------
def _dual(base_score: int, pres_score: int, at_risk: int = 0, confidence: float = 0.9):
    from app.domain.stages import DualGradeResult, Grade

    def grade(score):
        return Grade(
            score=score, criterion_matched="c", forgiven=[], penalized=[], justification="j"
        )

    return DualGradeResult(
        base=grade(base_score),
        presentation=grade(pres_score),
        points_at_risk=at_risk,
        risk_comment="r",
        how_to_protect_points="p",
        how_to_raise_base="b",
        summary="s",
        confidence=confidence,
    )


def test_presentation_above_base_lifts_the_base_not_swaps():
    """Presentation can only cost points the maths earned, never add them.

    The base is raised rather than the pair swapped: the model found that many
    points defensible under the criteria, so they were earned. Swapping would
    leave each grade's prose attached to the wrong number.
    """
    fixed, notes = normalise_grades(_dual(1, 2), max_score=4, allowed=[0, 1, 2, 3, 4])
    assert fixed.base.score == 2
    assert fixed.presentation.score == 2
    assert fixed.points_at_risk == 0
    assert any("выше базовой" in n for n in notes)


def test_points_at_risk_is_recomputed_when_the_model_miscounts():
    fixed, notes = normalise_grades(_dual(3, 1, at_risk=99), max_score=4, allowed=[0, 1, 2, 3, 4])
    assert fixed.points_at_risk == 2
    assert any("points_at_risk" in n for n in notes)


def test_both_grades_are_clamped_and_snapped_to_the_rubric():
    fixed, notes = normalise_grades(_dual(9, -3), max_score=4, allowed=[0, 2, 4])
    assert fixed.base.score == 4
    assert fixed.presentation.score == 0
    assert len(notes) >= 2


def test_a_clean_pair_is_left_alone():
    fixed, notes = normalise_grades(_dual(2, 1, at_risk=1), max_score=2, allowed=[0, 1, 2])
    assert (fixed.base.score, fixed.presentation.score, fixed.points_at_risk) == (2, 1, 1)
    assert notes == []
