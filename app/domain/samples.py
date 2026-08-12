"""Ready-made grading requests for smoke tests and demos.

Reachable as `GET /debug/samples` and `POST /debug/grading/sample?name=...`,
so a new environment can be exercised end to end without anyone having to
type a maths problem into curl.

Each sample carries a `expected_score_hint` describing what a competent human
expert would award.  It is *not* asserted against in tests (a real model is
not deterministic) -- it is there to make eyeballing a response quick, and to
seed the regression corpus described in docs/ROADMAP.md.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.domain.schemas import GradeRequest


class Sample(BaseModel):
    name: str
    note: str
    expected_score_hint: str
    request: GradeRequest


SAMPLES: dict[str, Sample] = {
    "13_partial": Sample(
        name="13_partial",
        note="Уравнение решено верно, отбор корней на отрезке выполнен неверно.",
        expected_score_hint="1 из 2 — верный пункт а), ошибка в пункте б)",
        request=GradeRequest(
            task_number=13,
            statement=(
                "а) Решите уравнение 2sin²x + 3cos x = 0.\n"
                "б) Найдите все корни этого уравнения, принадлежащие отрезку [−3π/2; 0]."
            ),
            student_solution=(
                "а) 2sin²x + 3cos x = 0\n"
                "2(1 − cos²x) + 3cos x = 0\n"
                "2 − 2cos²x + 3cos x = 0\n"
                "2cos²x − 3cos x − 2 = 0\n"
                "Пусть t = cos x, тогда 2t² − 3t − 2 = 0, D = 9 + 16 = 25.\n"
                "t = (3 ± 5)/4, значит t = 2 или t = −1/2.\n"
                "t = 2 не подходит, так как |cos x| ≤ 1.\n"
                "cos x = −1/2, x = ±2π/3 + 2πk, k ∈ Z.\n"
                "б) На отрезке [−3π/2; 0] лежит корень x = −2π/3."
            ),
            reference_answer="а) x = ±2π/3 + 2πk, k ∈ Z; б) −4π/3 и −2π/3",
        ),
    ),
    "16_model_error": Sample(
        name="16_model_error",
        note="Экономическая задача: модель построена неверно (процент взят от исходной суммы).",
        expected_score_hint="0 из 2 — неверная математическая модель",
        request=GradeRequest(
            task_number=16,
            statement=(
                "В июле 2026 года планируется взять кредит в банке на сумму 1 млн рублей "
                "на 3 года. Условия возврата таковы: каждый январь долг возрастает на 20% "
                "по сравнению с концом предыдущего года; с февраля по июнь необходимо "
                "выплатить часть долга; в июле каждого года долг должен быть на одну и ту же "
                "величину меньше долга на июль предыдущего года. Сколько рублей будет "
                "выплачено банку в течение всего срока?"
            ),
            student_solution=(
                "Долг уменьшается равномерно: 1000000 / 3 ≈ 333333 рублей в год.\n"
                "Каждый год начисляется 20% от 1000000 = 200000 рублей.\n"
                "За 3 года проценты составят 600000 рублей.\n"
                "Итого выплачено: 1000000 + 600000 = 1600000 рублей.\n"
                "Ответ: 1600000 рублей."
            ),
            reference_answer="1 400 000 рублей",
        ),
    ),
    "19_empty": Sample(
        name="19_empty",
        note="Ответ без решения — проверка ветки not_a_solution.",
        expected_score_hint="0 из 4 — verdict должен быть not_a_solution",
        request=GradeRequest(
            task_number=19,
            statement=(
                "На доске написано несколько различных натуральных чисел, каждое из которых "
                "не превосходит 20.\n"
                "а) Может ли сумма этих чисел равняться 100, если их ровно 7?\n"
                "б) Может ли сумма этих чисел равняться 100, если их ровно 4?\n"
                "в) Какое наименьшее количество чисел может быть написано, если их сумма равна 100?"
            ),
            student_solution="а) да\nб) нет\nв) 6",
            reference_answer="а) да; б) нет; в) 6",
        ),
    ),
}


def get_sample(name: str) -> Sample | None:
    return SAMPLES.get(name)
