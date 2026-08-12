"""Feature toggles for the grading prompts.

Several instructions in the prompt library are *hypotheses*, not facts. The
clearest one: stage 2 is told to solve the problem itself before looking at
the student's work, on the theory that you cannot tell a wrong route from an
unfamiliar one without having walked it. A strong enough model may not need
that — it costs a large share of the reasoning budget, and nobody has measured
whether it buys anything.

So the instruction goes behind a switch, and the switch is exposed where it
can be measured: per request, and on the test page. Benchmarking then means
running the same photograph twice with one toggle flipped and comparing the
grades, the tokens and the money — all three already recorded in the run
report.

Toggles gate *prompt text*. A toggle that selects a paragraph is inspectable
with `POST /debug/grading/preview-prompt` and cannot break the pipeline, so
that is the default and the shape to reach for.

Two toggles are something else, and each says which in its own field:

* `request_extra` — the switch is a provider request parameter, not a
  paragraph. Extended thinking is the case: asking a reasoning model in prose
  to "think harder" is not the same lever as turning its thinking on, and no
  amount of prompt text reaches it.
* `changes_flow` — see below.

One toggle is deliberately more than that. `reconstruct_first` removes a whole
stage: with it off the photograph goes straight to the analysis stage and
there is no transcript at all. That cannot be expressed as a paragraph, and
the test session said it is the change most worth measuring — most of the
score-affecting damage on photographs entered through stage 1's reading of the
handwriting. Such a toggle is marked `changes_flow=True`, which is what its
extra tests hang off; see invariant 8 in CLAUDE.md.

Adding one:

1. add a `Feature` here — this is the only registry, and the UI reads it;
2. wrap the passage in the `.md` file in `{% if your_key %} … {% endif %}`;
3. bump that prompt's `version`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.core.errors import ValidationError

# What switching a stage's extended thinking on looks like in the request body.
# The mirror image of the `{"thinking":{"type":"disabled"}}` documented for
# `LLM_EXTRA_BODY` in config.py. One constant, so a provider that spells it
# differently is a single edit rather than three.
#
# If the provider rejects it, the client drops it and the stage runs normally
# with a note on the run — a toggle must not be able to sink a grading.
THINKING_ON: dict[str, Any] = {"thinking": {"type": "enabled"}}


@dataclass(frozen=True)
class Feature:
    key: str
    title_ru: str
    description_ru: str
    default: bool
    stages: tuple[str, ...]
    # What flipping it is expected to do, so a benchmark has a hypothesis to
    # confirm or kill rather than a vague "seems better".
    hypothesis_ru: str = ""
    # True only for a toggle that also changes which stages run. Rare by
    # design — see the module docstring. The UI marks these, because flipping
    # one changes what a run costs and which other toggles still apply.
    changes_flow: bool = False
    # Merged into the provider request body for the stages above when the
    # toggle is on. For levers the prompt cannot reach: a reasoning model's
    # thinking is a request parameter, not a paragraph, and asking a model in
    # prose to "think harder" is not the same switch. A toggle with this set
    # has no `{% if %}` anywhere and is not expected to.
    request_extra: dict[str, Any] | None = None


FEATURES: tuple[Feature, ...] = (
    Feature(
        key="reconstruct_first",
        title_ru="Этап 1: распознавать рукопись отдельно",
        description_ru=(
            "Сначала фотография превращается в текстовую расшифровку, и разбор идёт "
            "по ней. Выключение убирает этап 1 целиком: снимок уходит прямо на "
            "разбор, и модель читает рукопись и ищет ошибки одним проходом. "
            "На текстовом вводе флаг ничего не меняет — там этапа 1 и так нет."
        ),
        hypothesis_ru=(
            "Отдельный этап распознавания — главный источник потери баллов на фото: "
            "неверно прочитанная цифра дальше уже не перепроверяется. Без него "
            "модель видит лист целиком и может перечитать спорное место, зная, чем "
            "решение кончается."
        ),
        default=True,
        stages=("stage2_analysis", "stage3_grading"),
        changes_flow=True,
    ),
    Feature(
        key="solve_independently",
        title_ru="Этап 2 сначала решает задачу сам",
        description_ru=(
            "Перед разбором работы модель полностью решает задачу — чтобы отличать "
            "неверный ход от непривычного. Выключение экономит заметную часть "
            "рассуждений."
        ),
        hypothesis_ru=(
            "Если модель достаточно сильная, разбор не станет хуже без собственного "
            "решения, но станет дешевле и быстрее."
        ),
        default=True,
        stages=("stage2_analysis",),
    ),
    Feature(
        key="use_reference_solution",
        title_ru="Показывать эталонное решение и ответ",
        description_ru=(
            "Передавать этапу 2 эталонное решение и верный ответ, когда они есть в "
            "запросе. Выключение проверяет, справляется ли модель без подсказки."
        ),
        hypothesis_ru=(
            "Эталон повышает точность, но может маскировать слабость модели: с ним "
            "нельзя понять, найдёт ли она ошибку на реальном потоке без эталона."
        ),
        default=True,
        stages=("stage2_analysis",),
    ),
    Feature(
        key="normalize_artifacts",
        title_ru="Исправлять артефакты распознавания",
        description_ru=(
            "Этап 1 молча приводит к норме одиночные описки-артефакты (потерянный "
            "минус, чужая цифра), если остальная запись согласована. Выключение "
            "оставляет всё как написано."
        ),
        hypothesis_ru=(
            "Исправления спасают от ложных ошибок из-за почерка, но рискуют затереть "
            "настоящую ошибку ученика."
        ),
        default=True,
        stages=("stage1_reconstruction",),
    ),
    Feature(
        key="describe_drawings",
        title_ru="Описывать чертёж текстом",
        description_ru=(
            "Этап 1 переводит рисунок в структурное описание: что построено, что "
            "обозначено, что отмечено. Для 14 и 17 это единственный способ донести "
            "геометрию до текстовых этапов."
        ),
        hypothesis_ru=(
            "Без описания планиметрия и стереометрия разбираются вслепую; с ним — "
            "ценой лишних токенов на каждом фото, включая те, где чертежа нет."
        ),
        default=True,
        stages=("stage1_reconstruction",),
    ),
    Feature(
        key="exhaustive_findings",
        title_ru="Искать находки исчерпывающе",
        description_ru=(
            "Этап 2 перечисляет всё, вплоть до мелочей, даже если балл за это не "
            "снимут. Выключение оставляет только то, что может повлиять на оценку."
        ),
        hypothesis_ru=(
            "Исчерпывающий список нужен оценке за оформление: то, что кажется "
            "мелочью на этапе 2, и есть балл под угрозой на этапе 3."
        ),
        default=True,
        stages=("stage2_analysis",),
    ),
    # --- extended thinking, one switch per stage --------------------------
    # Separate rather than one global switch because the stages want opposite
    # things and cost differently. Reading handwriting rewards literalism, not
    # deliberation; finding a flaw in an argument is exactly where thinking
    # earns its tokens. Off by default: reasoning tokens were already 49% of
    # the first test session's bill.
    Feature(
        key="deep_think_reconstruction",
        title_ru="Углублённое мышление на этапе 1",
        description_ru=(
            "Включает расширенные рассуждения модели при распознавании рукописи. "
            "Заметно дороже и медленнее."
        ),
        hypothesis_ru=(
            "Скорее всего не поможет: чтение почерка — не задача на рассуждение, а "
            "склонность «додумать» связное решение как раз и портит распознавание."
        ),
        default=False,
        stages=("stage1_reconstruction",),
        request_extra=THINKING_ON,
    ),
    Feature(
        key="deep_think_analysis",
        title_ru="Углублённое мышление на этапе 2",
        description_ru=(
            "Включает расширенные рассуждения при поиске ошибок — этап, где модель "
            "проверяет каждый переход и при включённом флаге решает задачу сама."
        ),
        hypothesis_ru=(
            "Самый вероятный выигрыш из трёх: пропущенная находка — это балл, "
            "который дальше уже никто не учтёт."
        ),
        default=False,
        stages=("stage2_analysis",),
        request_extra=THINKING_ON,
    ),
    Feature(
        key="deep_think_grading",
        title_ru="Углублённое мышление на этапе 3",
        description_ru=(
            "Включает расширенные рассуждения при выставлении баллов по готовому "
            "списку находок."
        ),
        hypothesis_ru=(
            "Этап 3 ничего не ищет, а сопоставляет находки с критериями. Если "
            "рассуждения тут что-то дают, то на спорном делении «содержание или "
            "оформление»."
        ),
        default=False,
        stages=("stage3_grading",),
        request_extra=THINKING_ON,
    ),
)

BY_KEY: dict[str, Feature] = {f.key: f for f in FEATURES}


def request_extra_for(stage: str, active: Mapping[str, bool]) -> dict[str, Any] | None:
    """Provider request-body fragment the enabled toggles ask for on `stage`.

    Registry-driven, so adding such a toggle needs no pipeline edit. `None`
    when nothing applies, which is what the client treats as "send what the
    settings say".
    """
    merged: dict[str, Any] = {}
    for feature in FEATURES:
        if feature.request_extra and stage in feature.stages and active.get(feature.key):
            merged.update(feature.request_extra)
    return merged or None


def defaults() -> dict[str, bool]:
    return {f.key: f.default for f in FEATURES}


def resolve(
    *,
    configured: Mapping[str, bool] | None = None,
    override: Mapping[str, bool] | None = None,
) -> dict[str, bool]:
    """Registry defaults, then deployment config, then this request.

    The per-request layer is what makes benchmarking possible without a
    redeploy: the same photograph, one toggle flipped, two reports to compare.
    """
    resolved = defaults()
    for layer in (configured, override):
        for key, value in (layer or {}).items():
            if key not in BY_KEY:
                raise ValidationError(
                    f"неизвестный feature-флаг: {key}",
                    details={"known": sorted(BY_KEY)},
                )
            resolved[key] = bool(value)
    return resolved


def describe(active: Mapping[str, bool] | None = None) -> list[dict[str, object]]:
    """Registry as data, for `/debug/features` and the test page."""
    state = dict(defaults())
    state.update(active or {})
    return [
        {
            "key": f.key,
            "title_ru": f.title_ru,
            "description_ru": f.description_ru,
            "hypothesis_ru": f.hypothesis_ru,
            "default": f.default,
            "enabled": state[f.key],
            "stages": list(f.stages),
            "changes_flow": f.changes_flow,
            # The UI labels these: they cost money at the provider rather than
            # changing a paragraph, so "no visible prompt diff" is expected.
            "request_extra": f.request_extra,
        }
        for f in FEATURES
    ]


def non_default(active: Mapping[str, bool]) -> dict[str, bool]:
    """Only what differs from the registry — what a benchmark run is testing."""
    return {k: v for k, v in active.items() if k in BY_KEY and v != BY_KEY[k].default}
