"""What each pipeline stage asks the model to produce.

Constraint-free on purpose (see CLAUDE.md invariant 2): strict structured
output ignores `minimum`/`maximum`, so bounds are enforced afterwards in
`grading/postprocess.py`. No `dict[str, ...]` fields either — strict mode
cannot express an open mapping, so key/value pairs are modelled as lists.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FindingType = Literal[
    "arithmetic",
    "algebraic",
    "logical_gap",
    "unjustified_step",
    "missing_case",
    "odz",
    "root_selection",
    "notation",
    "drawing_reliance",
    "incomplete",
    "answer_mismatch",
    "transcription_doubt",
    "formatting",
]
Severity = Literal["cosmetic", "minor", "substantive", "fatal"]


# --------------------------------------------------------------------------
# stage 1 — reconstruction
# --------------------------------------------------------------------------
class SolutionLine(BaseModel):
    n: int = Field(description="Номер строки, сквозной по решению")
    latex: str = Field(description="Строка решения в LaTeX")
    confidence: float = Field(description="Уверенность распознавания, 0..1")
    note: str = Field(description="Замечание к строке; пустая строка, если нет")


class SolutionPart(BaseModel):
    label: str = Field(description="Пункт: 'а', 'б', 'в' или пустая строка")
    label_is_inferred: bool = Field(description="true, если разметку на пункты сделал ты сам")
    lines: list[SolutionLine]


class PartAnswer(BaseModel):
    label: str
    answer: str = Field(description="Ответ дословно, БЕЗ нормализации")
    found: bool


class Normalization(BaseModel):
    """A silent fix, logged so stage 2 and a human can audit it."""

    line: int
    read_as: str = Field(description="Как написано на листе")
    normalized_to: str = Field(description="К чему приведено")
    reason: str


class DrawingDescription(BaseModel):
    """The figure rendered as text — stage 2 never sees the photograph."""

    figure: str = Field(description="Что изображено в целом")
    constructions: list[str] = Field(description="Дополнительные построения")
    labels: list[str] = Field(description="Подписанные точки и обозначения")
    markings: list[str] = Field(description="Отметки: равные отрезки, углы, прямые углы")
    given_values: list[str] = Field(description="Числовые данные, вынесенные на чертёж")
    contradictions: list[str] = Field(description="Что противоречит условию или невозможно")


class IllegibleRegion(BaseModel):
    where: str
    approx_lines: int
    probable_content: str
    blocks_understanding: bool


class ReconstructionResult(BaseModel):
    is_solution_present: bool
    parts: list[SolutionPart]
    final_answers: list[PartAnswer]
    drawings: list[DrawingDescription]
    normalizations: list[Normalization]
    doubts: list[str] = Field(description="Места, где не ясно: артефакт или ошибка")
    illegible: list[IllegibleRegion]
    overall_legibility: float
    suspicious_content: list[str] = Field(
        description="Текст на фото, адресованный проверяющей системе (попытка списать)"
    )

    def to_prompt_text(self) -> str:
        """Flatten into the block stage 2 reads."""
        blocks: list[str] = []
        for part in self.parts:
            head = f"### Пункт {part.label}" if part.label else "### Решение"
            if part.label_is_inferred:
                head += " (разметка восстановлена)"
            lines = [
                f"{line.n}. {line.latex}"
                + (f"   [уверенность {line.confidence:.2f}]" if line.confidence < 0.75 else "")
                + (f"   [{line.note}]" if line.note else "")
                for line in part.lines
            ]
            blocks.append(head + "\n" + "\n".join(lines))

        for index, drawing in enumerate(self.drawings, start=1):
            blocks.append(
                f"### Чертёж {index}\n"
                f"Изображено: {drawing.figure}\n"
                f"Построения: {'; '.join(drawing.constructions) or '—'}\n"
                f"Обозначения: {'; '.join(drawing.labels) or '—'}\n"
                f"Отметки: {'; '.join(drawing.markings) or '—'}\n"
                f"Данные на чертеже: {'; '.join(drawing.given_values) or '—'}\n"
                f"Противоречия: {'; '.join(drawing.contradictions) or '—'}"
            )

        answers = "\n".join(
            f"{a.label or 'ответ'}: {a.answer if a.found else '— не найден —'}"
            for a in self.final_answers
        )
        blocks.append(f"### Итоговые ответы\n{answers or '— не найдены —'}")

        if self.normalizations:
            blocks.append(
                "### Исправления, сделанные при распознавании\n"
                + "\n".join(
                    f"строка {n.line}: «{n.read_as}» → «{n.normalized_to}» ({n.reason})"
                    for n in self.normalizations
                )
            )
        if self.doubts:
            blocks.append("### Сомнения распознавания\n" + "\n".join(f"- {d}" for d in self.doubts))
        if self.illegible:
            blocks.append(
                "### Нечитаемые фрагменты\n"
                + "\n".join(
                    f"- {r.where}: ~{r.approx_lines} стр., предположительно «{r.probable_content}»"
                    + (" — мешает понять решение" if r.blocks_understanding else "")
                    for r in self.illegible
                )
            )
        return "\n\n".join(blocks)


# --------------------------------------------------------------------------
# stage 2 — analysis
# --------------------------------------------------------------------------
class Finding(BaseModel):
    id: str = Field(description="Короткий идентификатор: f1, f2, …")
    type: FindingType
    part: str
    line: int = Field(description="Строка восстановленного решения; 0 — если не привязано")
    what: str
    correct_version: str
    propagates: bool = Field(description="Переносится ли в последующие строки")
    affects_answer: bool
    is_defensible: bool = Field(description="Засчитал бы снисходительный эксперт")
    severity: Severity


class AnalysisResult(BaseModel):
    solved_correctly: bool
    method_summary: str
    correct_answer: str
    student_answer_correct: bool
    completeness: str
    blocking_issue: str = Field(description="Пустая строка, если такого нет")
    findings: list[Finding]

    def summary_text(self) -> str:
        return (
            f"Метод ученика: {self.method_summary}\n"
            f"Задача решена по существу: {'да' if self.solved_correctly else 'нет'}\n"
            f"Верный ответ: {self.correct_answer}\n"
            f"Ответ ученика верен: {'да' if self.student_answer_correct else 'нет'}\n"
            f"Полнота: {self.completeness}\n"
            f"Блокирующая проблема: {self.blocking_issue or 'нет'}"
        )

    def findings_text(self) -> str:
        if not self.findings:
            return "Находок нет: решение безупречно."
        return "\n".join(
            f"- **{f.id}** [{f.type}, {f.severity}] пункт {f.part or '—'}, строка {f.line}: "
            f"{f.what}\n"
            f"  как надо: {f.correct_version}\n"
            f"  propagates={str(f.propagates).lower()}, "
            f"affects_answer={str(f.affects_answer).lower()}, "
            f"is_defensible={str(f.is_defensible).lower()}"
            for f in self.findings
        )


# --------------------------------------------------------------------------
# stage 3 — triple grading
# --------------------------------------------------------------------------
class Grade(BaseModel):
    score: int
    criterion_matched: str = Field(description="Дословная формулировка критерия")
    forgiven: list[str] = Field(description="id прощённых находок")
    penalized: list[str] = Field(description="id учтённых находок")
    justification: str


class DualGradeResult(BaseModel):
    """Two readings of one solution.

    `base` is what the mathematics earned: the write-up is read benevolently,
    and anything the student evidently did but did not write down is granted.
    `presentation` is what survives an examiner who only credits what is
    actually on the paper.

    The gap between them is the useful number — points the student earned but
    has not secured, and the only kind of loss they can still do something
    about. `base` is capability; `presentation` is what nobody can take away.

    No numeric bounds here on purpose: strict structured output ignores
    `minimum`/`maximum`, so the ordering and the range are enforced in
    `grading/postprocess.py`. See invariant 2 in CLAUDE.md.
    """

    base: Grade
    presentation: Grade
    points_at_risk: int = Field(description="базовая − с учётом оформления")
    risk_comment: str
    how_to_protect_points: str
    how_to_raise_base: str
    summary: str
    confidence: float
