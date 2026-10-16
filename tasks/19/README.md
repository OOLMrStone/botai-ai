# Задание 19

Номер проекта — **19**, источник ФИПИ-2026 — **18**: задача с параметром, максимум 4. ID примеров ФИПИ (`18.1.1` и т.д.) сохраняются для сверки с источником.

**Статус (15.10.2026):** пакет промптов в [prompts/](prompts/) (`criteria.md`, `ocr.md`, `popular_mistakes.md`, `ocr_biases.md`), общие `main.md`, `analysis.md`, `grading.md`, `response-format.md` — в `tasks/common/prompts/`. Проверка по схеме «чтец → анализ → оценка», как у 14 и 16 (ветка `staged-17-19-20`). Критерии ФИПИ у каждой задачи свои; в `prompts/criteria.md` — общая схема, конкретику модель берёт из эталонного решения.

Evals: [evals/fipi/](evals/fipi/) — 19 оценённых работ из методички ФИПИ-2026 (стр. 195–226), нарезаны `scripts/prepare_fipi_evals.py`. Результаты прогонов — в `tasks/common/hypotheses/runs-ledger.md`.
