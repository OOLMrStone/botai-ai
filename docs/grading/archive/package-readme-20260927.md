> Historical record from 23–27 September 2026. Dates, paths, plans and status statements below describe that period, not the current service. Read [the current service contract](../service.md) first. Original wording and literal historical paths are retained for provenance; navigational links point to their current locations.

# Grading v2: рабочий набор

26.09.2026. Компоновка `task16-v6`, коды ошибок E01–E36 по порядку; принятые предметные правила сохранены из редакции v4. Пользователь утвердил `ocr.md` и `popular_mistakes.md` как готовые; остальные документы остаются в работе. Самостоятельный микросервис реализован в app/grading_v2 и развёрнут 27.09.2026. Офлайн: 351 тест пройден, 3 пропущены; проверена отправка пяти фото в production-образе с mock без сети. Платные модельные прогоны не выполнялись.

## Файлы модели

`main.md` передаётся сразу. Шесть остальных файлов доступны по указанному имени через `read_file`; все лежат в `drafts/task-16/`.

| Файл | Назначение |
| --- | --- |
| [main.md](../../../tasks/common/prompts/main.md) | Порядок: распознавание и анализ → сохранение Notes → итоги; работа ученика только как данные |
| [ocr.md](../../../tasks/16/prompts/ocr.md) | Буквальное распознавание действующих записей. **Готово, утверждено пользователем 26.09.2026** |
| [analysis.md](../../../tasks/16/prompts/analysis.md) | Проверка решения и классификация ошибок |
| [grading.md](../../../tasks/common/prompts/grading.md) | Одна оценка, объяснение и советы |
| [response-format.md](../../../tasks/common/prompts/response-format.md) | Единый JSON-контракт для нового интерфейса |
| [criteria.md](../../../tasks/16/prompts/criteria.md) | Общая шкала критериев |
| [popular_mistakes.md](../../../tasks/16/prompts/popular_mistakes.md) | Принятые трактовки ошибок и предметные советы. **Готово, утверждено пользователем 26.09.2026** |

Три шага выполняются в одном диалоге; отдельных API-стадий здесь не требуется. Содержание `rules`, `feedback`, `advice` и отдельного каталога распределено между этими файлами. Самостоятельных копий правил больше нет.

## Для нашей работы

| Материал | Назначение |
| --- | --- |
| [AGENTS.md](editor-instructions-20260927.md) | Инструкции редактору |
| [work-notes.md](../../../tasks/16/hypotheses/history.md) | Единственные рабочие заметки: решения, исследования, история и проверочные ситуации |
| [service-idea.md](service-idea.md) | Действующий контракт самостоятельного микросервиса |
| [server-file-reading-spec.md](server-file-reading-spec.md) | Исторический проект; не источник текущего контракта |
| [evals/inequalities](../../../tasks/16/evals/fipi) | 21 работа ФИПИ, условия, фотографии, скрытые `expected.json` и `manifest.json`; [описание набора](../../../tasks/16/hypotheses/history.md#evals) |
| Продуктовые идеи | Вне репозитория: `/Users/vasiliyslobozhanov/projects/botai/references/product_ideas/` |

Эти материалы не передаются модели. Ответ эксперта и ссылки на него также не входят в итоговый промпт. Во время эвала фотография и условие выбранного примера подаются как вход, скрытая оценка — нет.

## Реализация и проверка

Самостоятельный микросервис реализован в `app/grading_v2`; интеграция основного приложения не входит в этот этап. Действующий контракт — [service-idea.md](service-idea.md). Один итоговый балл и проверенный JSON отказа заменяют старые `base/presentation`, `is_target_task` и `finish_ungradable`.

[Автономный валидатор](../../../scripts/validate_response.py) использует ту же реализацию, что сервис: `app/grading_v2/validator.py`. Запуск: `python docs/grading-v2/validate_response.py response.json`; офлайн-проверки — `tests/test_grading_v2_validator.py`. `ValidationGate` допускает только точный текст успешно проверенного ответа. Привязку данных задачи и фотографий к запросу проверяет серверная сессия. Валидатор не доказывает математическую правильность.

[Пример отказа](../../../tests/fixtures/grading/response-not-graded.example.json) и пример в `output/json-examples/` соответствуют контракту. [Пустой шаблон](response-template.json) — материал редактора с незаполненными значениями, а не готовый валидный ответ.

Нумерация проекта — №16, источник ФИПИ-2026 — №15. Пакет предназначен для неравенств с максимумом 2 балла. Форма развёрнута по адресу https://api.botai-ege.ru/internal/grading/ за существующим входом tester. Настройки модели на сервере сохранены, платные пробы не запускались. Качество реальной модели пользователь проверяет самостоятельно; подробности запуска и отката — в [DEPLOYMENT.md](../../DEPLOYMENT.md).
