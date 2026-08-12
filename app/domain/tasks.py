"""Registry of part-2 tasks of the EGE in profile mathematics (задания 13-19).

Structure of part 2 (formats from 2022 onwards), 20 primary points total:

    13  тригонометрическое (или показательное/логарифмическое) уравнение   2
    14  стереометрия                                                       3
    15  неравенство                                                        2
    16  экономическая задача                                               2
    17  планиметрия                                                        3
    18  задача с параметром                                                4
    19  числа и их свойства                                                4

!! PROVENANCE -- READ BEFORE TRUSTING THE RUBRICS !!
The `criteria` below reproduce the *shape* of the official ФИПИ rubrics
(how many points, what distinguishes each band).  The exact wording is
generalised, and for задания 14/17/18/19 the real rubric is partly
problem-specific -- ФИПИ ships per-problem criteria with each variant.

Two consequences, both handled by the API rather than by editing this file:

* `GradeRequest.criteria_override` accepts the exact rubric for the problem
  at hand and takes precedence over everything here.
* `GradeRequest.max_score` can override the default when a variant differs.

Treat this registry as a sane default, not as the source of truth.  Before
production use, reconcile it against the current demo version on fipi.ru
(see docs/DOMAIN_EGE.md).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.errors import UnknownTaskError

CRITERIA_SOURCE = (
    "generalised ФИПИ rubric shape; verify against the current demo version, "
    "and pass problem-specific criteria via criteria_override"
)


class Criterion(BaseModel):
    """One band of a rubric: 'this many points are awarded when ...'."""

    points: int = Field(description="Баллы, выставляемые при выполнении условия")
    description: str = Field(description="Условие выставления баллов")


class TaskSpec(BaseModel):
    number: int
    topic: str
    topic_ru: str
    max_score: int
    parts: list[str] = Field(default_factory=list, description="Пункты задания, напр. ['а', 'б']")
    criteria: list[Criterion]
    grader_notes: str = Field(
        description="Что чаще всего теряет баллы в этом номере; уходит в промпт"
    )


def _zero(text: str = "Решение не соответствует ни одному из критериев, перечисленных выше.") -> Criterion:
    return Criterion(points=0, description=text)


TASK_REGISTRY: dict[int, TaskSpec] = {
    13: TaskSpec(
        number=13,
        topic="equation",
        topic_ru="Уравнение (тригонометрическое, показательное или логарифмическое)",
        max_score=2,
        parts=["а", "б"],
        criteria=[
            Criterion(points=2, description="Обоснованно получены верные ответы в обоих пунктах."),
            Criterion(
                points=1,
                description=(
                    "Обоснованно получен верный ответ в пункте а) ИЛИ обоснованно "
                    "получен верный ответ в пункте б)."
                ),
            ),
            _zero(),
        ],
        grader_notes=(
            "Пункт а) — решить уравнение, пункт б) — отобрать корни на отрезке. "
            "Типичные потери: не указана ОДЗ для логарифмов и дробей; серия корней "
            "записана неверно (потеряно 2πn или πn); отбор корней выполнен подбором "
            "без обоснования; в ответ пункта б) попали корни вне отрезка или "
            "потеряны граничные точки. Ответ пункта а) в виде серии корней — "
            "проверяй эквивалентность записи, а не совпадение символ в символ."
        ),
    ),
    14: TaskSpec(
        number=14,
        topic="stereometry",
        topic_ru="Стереометрия",
        max_score=3,
        parts=["а", "б"],
        criteria=[
            Criterion(
                points=3,
                description=(
                    "Имеется верное доказательство утверждения пункта а) и обоснованно "
                    "получен верный ответ в пункте б)."
                ),
            ),
            Criterion(
                points=2,
                description=(
                    "Обоснованно получен верный ответ в пункте б) ИЛИ имеется верное "
                    "доказательство утверждения пункта а) и при обоснованном решении "
                    "пункта б) получен неверный ответ из-за арифметической ошибки."
                ),
            ),
            Criterion(points=1, description="Имеется верное доказательство утверждения пункта а)."),
            _zero(),
        ],
        grader_notes=(
            "Пункт а) — доказательство, пункт б) — вычисление. Доказательство "
            "оценивается по логической полноте: каждая ссылка на признак "
            "(перпендикулярности, параллельности прямой и плоскости) должна быть "
            "явной. Типичные потери: используется чертёж вместо обоснования; "
            "положение точки/сечения принято без доказательства; не обосновано, "
            "что построенный угол — искомый (линейный угол двугранного). Пункты "
            "оцениваются независимо: неверный а) не обнуляет верный б)."
        ),
    ),
    15: TaskSpec(
        number=15,
        topic="inequality",
        topic_ru="Неравенство",
        max_score=2,
        parts=[],
        criteria=[
            Criterion(points=2, description="Обоснованно получен верный ответ."),
            Criterion(
                points=1,
                description=(
                    "Обоснованно получен ответ, отличающийся от верного исключением "
                    "или включением отдельных точек, ИЛИ верное решение содержит "
                    "вычислительную ошибку, не влияющую на ход решения."
                ),
            ),
            _zero(),
        ],
        grader_notes=(
            "Проверяй ОДЗ и корректность равносильных переходов: домножение на "
            "выражение неизвестного знака, потеря условия положительности под "
            "логарифмом, смена знака неравенства при делении на отрицательное. "
            "Метод интервалов должен опираться на найденные нули и точки разрыва. "
            "Ответ — множество; проверяй строгость/нестрогость границ."
        ),
    ),
    16: TaskSpec(
        number=16,
        topic="economics",
        topic_ru="Экономическая задача (финансовая математика)",
        max_score=2,
        parts=[],
        criteria=[
            Criterion(points=2, description="Обоснованно получен верный ответ."),
            Criterion(
                points=1,
                description=(
                    "Верно построена математическая модель, решение доведено до конца, "
                    "получен неверный ответ из-за вычислительной ошибки, ИЛИ верно "
                    "построена математическая модель, но решение не доведено до конца."
                ),
            ),
            _zero(),
        ],
        grader_notes=(
            "Ключевое — математическая модель: схема кредита (аннуитет или "
            "дифференцированные платежи), к чему применяется процент и в какой "
            "момент. Типичные потери: путаница между процентом от исходной и от "
            "остаточной суммы; неверное число периодов; ответ не округлён по "
            "смыслу задачи (рубли, месяцы) или округлён не в ту сторону. Единицы "
            "измерения в ответе обязательны."
        ),
    ),
    17: TaskSpec(
        number=17,
        topic="planimetry",
        topic_ru="Планиметрия",
        max_score=3,
        parts=["а", "б"],
        criteria=[
            Criterion(
                points=3,
                description=(
                    "Имеется верное доказательство утверждения пункта а) и обоснованно "
                    "получен верный ответ в пункте б)."
                ),
            ),
            Criterion(
                points=2,
                description=(
                    "Обоснованно получен верный ответ в пункте б) ИЛИ имеется верное "
                    "доказательство утверждения пункта а) и при обоснованном решении "
                    "пункта б) получен неверный ответ из-за арифметической ошибки."
                ),
            ),
            Criterion(points=1, description="Имеется верное доказательство утверждения пункта а)."),
            _zero(),
        ],
        grader_notes=(
            "Пункт а) — доказательство, пункт б) — вычисление. Типичные потери: "
            "конфигурация взята с чертежа (какая точка лежит между какими) без "
            "обоснования; не разобран второй случай расположения (центр вне "
            "треугольника, тупой угол); ссылка на подобие без указания признака. "
            "Если возможны несколько конфигураций, полный балл — только когда "
            "разобраны все или обоснованно отброшены лишние."
        ),
    ),
    18: TaskSpec(
        number=18,
        topic="parameter",
        topic_ru="Задача с параметром",
        max_score=4,
        parts=[],
        criteria=[
            Criterion(points=4, description="Обоснованно получен верный ответ."),
            Criterion(
                points=3,
                description=(
                    "С помощью верного рассуждения получены все значения параметра, "
                    "но решение недостаточно обосновано или содержит описку."
                ),
            ),
            Criterion(
                points=2,
                description="С помощью верного рассуждения получена часть значений параметра.",
            ),
            Criterion(
                points=1,
                description=(
                    "Задача верно сведена к исследованию, рассмотрен хотя бы один "
                    "случай, но значения параметра не получены."
                ),
            ),
            _zero(),
        ],
        grader_notes=(
            "Оценивается полнота разбора случаев, а не только итоговое множество. "
            "Типичные потери: графический метод без аналитического обоснования "
            "касания/пересечения; не рассмотрен вырожденный случай (старший "
            "коэффициент равен нулю, знаменатель обращается в нуль); найдены "
            "верные значения, но не доказано, что других нет. Частично верный "
            "набор значений — это 2 балла, а не 0."
        ),
    ),
    19: TaskSpec(
        number=19,
        topic="number_theory",
        topic_ru="Числа и их свойства",
        max_score=4,
        parts=["а", "б", "в"],
        criteria=[
            Criterion(points=4, description="Верно получены все перечисленные результаты."),
            Criterion(points=3, description="Верно получены любые три из перечисленных результатов."),
            Criterion(points=2, description="Верно получены любые два из перечисленных результатов."),
            Criterion(points=1, description="Верно получен один из перечисленных результатов."),
            _zero(),
        ],
        grader_notes=(
            "«Перечисленные результаты» — это пункты а), б), в) и, как правило, "
            "отдельно оцениваемые оценка и пример в пункте в). Пункт а) обычно "
            "требует лишь примера (пример без обоснования засчитывается), пункт б) "
            "— доказательства невозможности, пункт в) — И оценки, И примера, на "
            "котором она достигается. Типичные потери: в пункте в) приведена "
            "оценка без примера (или наоборот) — результат засчитывается только "
            "наполовину; ответ угадан без доказательства оптимальности. "
            "ВАЖНО: список результатов зависит от конкретной задачи — при наличии "
            "передавай точные критерии через criteria_override."
        ),
    ),
}

PART_TWO_NUMBERS: tuple[int, ...] = tuple(sorted(TASK_REGISTRY))
PART_TWO_MAX_SCORE: int = sum(spec.max_score for spec in TASK_REGISTRY.values())


def get_task_spec(number: int) -> TaskSpec:
    spec = TASK_REGISTRY.get(number)
    if spec is None:
        raise UnknownTaskError(
            f"задание {number} не входит во вторую часть ЕГЭ по профильной математике",
            details={"supported": list(PART_TWO_NUMBERS)},
        )
    return spec
