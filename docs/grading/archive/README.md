# Архив решений 23–27 сентября 2026

Исторические тексты сохраняют исходные формулировки и старые пути для сверки. Они не описывают текущее состояние. Читать по необходимости после [контракта сервиса](../service.md), а не все подряд при запуске агента.

| Ранее | Теперь |
| --- | --- |
| docs/grading-v2/drafts/task-16/main, grading, response-format | tasks/common/prompts/ |
| docs/grading-v2/drafts/task-16/ocr, analysis, criteria, popular_mistakes | tasks/16/prompts/ |
| docs/grading-v2/evals/inequalities | tasks/16/evals/fipi/ |
| docs/grading-v2/evals/kostyan_evals | tasks/16/evals/kostyan/ |
| docs/grading-v2/validate_response.py | scripts/validate_response.py |
| docs/grading-v2/work-notes.md | [История задания 16](../../../tasks/16/hypotheses/history.md) |
| app/grading_v2/ и tests/test_grading_v2_* | app/grading/ и tests/test_grading_* |
| app/grading/pipeline.py, postprocess.py, prompts.py прежнего сервиса | app/legacy_grading/ |
| packages/grading-v2/, grading_v2/ingress.py, tools.py и validator_core.py | Исторически предложенные компоненты, не реализованные пути; см. текущий service.md |
| Старый README пакета | [package-readme-20260927.md](package-readme-20260927.md) |

editor-instructions-20260927.md в этом архиве — историческая запись, действующие предпочтения находятся в [editor-guidelines.md](../editor-guidelines.md). Старый подробный server-file-reading-spec включает не реализованные предложения. Навигационные ссылки внутри архивных записей обновлены. Исторические пути в коде и цитатах сверять по таблице; исходные пользовательские слова не переписаны.

[Сверка main, dfda и ec15](source-reconciliation.md) фиксирует различия ранних контрактов и подтверждает сохранность идей при объединении.
