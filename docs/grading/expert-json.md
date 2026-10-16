# JSON для экрана эксперта

Решения Васи — [tasks/common/hypotheses/expert-json-decisions.md](../../tasks/common/hypotheses/expert-json-decisions.md). Проверка — `app/grading/expert_json.py`, пример — [expert-json-example.json](expert-json-example.json) (работа ФИПИ 15.2.3, та же, что в прототипе «Кабинет эксперта»).

## Кто что пишет

| Этап | Пишет | Проверка |
| --- | --- | --- |
| Чтение | `ocr`: шаги решения, тип шага, строки, рисунок; ответ ученика | `ocr_errors(ocr)` |
| Анализ | `analysis.statuses`: статус и одно замечание на каждый шаг | `status_errors(ocr, statuses)` |
| Сервер | итоговый JSON | `final_errors(response, ocr_от_чтеца)` — `ocr` не изменился, у каждого шага статус |

Если проверка находит ошибку, этап переделывается (как с валидатором ответа).

JSON есть у всех номеров 14–20. У 14, 16, 17, 19, 20 (этапы «чтец → анализ → оценка») статусы ставит анализ, `step_id`, `penalty` и `correct` — оценка. У 15 и 18 (цикл с инструментами) после готовой оценки идут два коротких вызова без рассуждения: разметка расшифровки на шаги (у 15 — расшифровка чтеца, у 18 — расшифровка самой модели) и перенос готовой рецензии на шаги; балл и рецензия не меняются. Если результат не проходит валидатор после двух исправлений, возвращается обычный ответ с текстовым `ocr` (`structure.screen_response`).

## Формат

```
ocr = {"steps": [step, ...], "answer": "x ∈ (2; +∞)"}
step = {"id": "s1", "type": "odz", "title": "Область допустимых значений", "lines": ["<строка расшифровки дословно: формулы LaTeX в $…$, остальное текстом>", ...], "figure": null | figure}
```

Типы шагов — свой список у каждого номера (решение Васи 15.10: шаги под каждое задание свои):

| Номер | Типы шагов |
| --- | --- |
| 14 уравнение | condition, odz, substitution, transform, solve, back_substitution, selection, answer, other |
| 15 стереометрия | condition, construction, proof, computation, answer, other |
| 16 неравенство | condition, odz, substitution, transform, solve, intervals, back_substitution, selection, answer, other |
| 17 экономика | condition, model, transform, computation, solve, answer, other |
| 18 планиметрия | condition, construction, proof, computation, answer, other |
| 19 параметр | condition, odz, substitution, transform, model, construction, critical, cases, answer, other |
| 20 числа | condition, example, proof, estimate, computation, answer, other |

Значения: condition — запись условия; odz — ОДЗ; substitution — замена; transform — преобразование; solve — решение простейшего уравнения или неравенства; intervals — метод интервалов; back_substitution — обратная замена; selection — отбор (корни на отрезке, учёт ОДЗ); construction — рисунок, построение, график; proof — доказательство; computation — вычисление; model — сведение задачи к уравнению, неравенству или системе; critical — критические значения параметра; cases — исследование случаев, число решений; example — пример; estimate — оценка; answer — ответ (у задач с пунктами — по шагу на пункт, пункт в `title`); other — другое.

Шаг может отсутствовать: замены нет — нет и шагов substitution и back_substitution. Тип вне списка своего номера валидатор не пропускает (`ocr_errors(ocr, task_number)`).

Числовая прямая:

```
{"kind": "number_line", "variable": "t", "note": "При t > 0",
 "points": [{"id": "p1", "value": "-9", "included": false, "sign": null}, ...],
 "arcs":   [{"from": "p4", "to": "+inf", "sign": "+", "selected": true}, ...]}
```

- Точки — слева направо в том порядке, как у ученика, не в масштабе.
- `included` — закрашена (входит в ответ) или выколота.
- Дуги соединяют точки по `id`; крайние лучи — `-inf` / `+inf`; петля над одной точкой — дуга с `from` = `to`.
- Знак — только `+`, `-` или `0`; `selected` — промежуток выделен (штриховка).
- Граница области пунктиром («При t > 0») — точка с `"bound": true`, у неё `included` может быть `null`.

Окружность (задание 14): `{"kind": "unit_circle", "points": [...], "arcs": [...]}` — те же точки и дуги, без `-inf`/`+inf`.

Статусы анализа: `ok` (верно), `error` (ошибка), `consequence` (следствие ошибки), `minor` (недочёт). У шага ровно один статус и не больше одного замечания; для `error`, `consequence`, `minor` замечание обязательно.

## Поля под прототип (видео «Кабинет эксперта»)

| На экране | Поле | Кто пишет |
| --- | --- | --- |
| Метка шага: галочка, «Потеряна точка t = 3», «Следствие ошибки» | `analysis.statuses[]`: `status`, `note` | анализ |
| Всплывашка у шага-ошибки или следствия: исправленная запись (`x ∈ {1} ∪ (2; +∞)`) | `analysis.statuses[].correct` — только у `error` и `consequence` | оценка (`corrections`, сервер переносит в статус) |
| Карточка ошибки: название, текст, совет | `analysis.errors[]`: `description`, `where` / `correct_version`, `advice` | оценка |
| «−1 балл» на карточке | `analysis.errors[].penalty` — целое, 0 за следствие и повтор; сумма не больше `max_score − score` | оценка |
| «Показать в решении» | `analysis.errors[].step_id` — шаг, где видна ошибка, или `null` | оценка |
| Советы ученику | `analysis.errors[].advice` | оценка |
| Две колонки в шаге | нет поля: раскладывает фронт | — |

Проверка — `issue_errors` и `status_errors` в `app/grading/expert_json.py`; при нарушении ответ оценки переделывается.

Спорного прочтения в формате нет: спорные места снимаются на этапе чтения независимыми вызовами (2 из 3).

Проверка из командной строки:

```
python -m app.grading.expert_json ocr reader.json
python -m app.grading.expert_json statuses statuses.json --ocr reader.json
python -m app.grading.expert_json final response.json --ocr reader.json
```
