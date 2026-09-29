> Исторический аудит входов прогона 27.09.2026. Пути и хеши ниже сохранены как свидетельства того запуска. Бывший `docs/grading-v2/evals/inequalities/manifest.json` теперь находится в `tasks/16/evals/fipi/manifest.json`; перенос не означает повторный прогон.

# Input audit — 27 September 2026

The manifest at `docs/grading-v2/evals/inequalities/manifest.json` contains 21 cases and six shared task images. All referenced task images, student images and expected JSON files exist. All 21 student images decode successfully and are below the 8 MiB per-image limit.

## Exact visual coverage

All six task images were visually inspected: `problems/15.1.png`, `15.2.png`, `15.3.png`, `15.4.png`, `15.5.png`, `15.6.png`. Each contains the printed problem statement and correct answer, with no expert score or expert commentary. None contains the full reference solution. The preparation stage should therefore produce `reference_solution=null`, not invent a reference derivation.

All 21 `solution.png` files were visually inspected:

- 15.1.1, 15.1.2, 15.1.3, 15.1.4
- 15.2.1, 15.2.2, 15.2.3, 15.2.4
- 15.3.1, 15.3.2, 15.3.3, 15.3.4
- 15.4.1, 15.4.2, 15.4.3, 15.4.4
- 15.5.1, 15.5.2, 15.5.3
- 15.6.1, 15.6.2

These crops contain handwritten student work, including student task numbers, explanations, diagrams, corrections and answers. No printed expert score, grading rubric or expert verdict was observed in any crop. No replacement or recropping was needed. This audit checks separation of evaluation labels from image inputs; it does not assess mathematical correctness or guarantee OCR accuracy.

## Hidden labels and provenance

Each `expected.json` has exactly `score` (integer 0, 1 or 2) and `verdict` (string). Distribution: 11 scores of 2, four scores of 1 and six scores of 0.

The manifest maps cases to source pages 90–110 of `matematika_mr_ege_2026.pdf`, source task 15 and product task 16. The local original exists at `/Users/vasiliyslobozhanov/projects/botai/references/matematika_mr_ege_2026.pdf`. The official source is [ФИПИ, методические материалы ЕГЭ-2026 по математике](https://doc.fipi.ru/ege/dlya-predmetnyh-komissiy-subektov-rf/2026/matematika_mr_ege_2026.pdf). The historical [work notes](../../../../hypotheses/history.md#evals) record previous verification of all 21 scores against the source PDF; this input audit did not repeat that page-by-page label verification.

For each request, send only `problem_and_reference_answer` as `task_image` and `solution` as `solution_images`. Keep expected scores, expert verdicts, source-page grading commentary and this audit outside model messages. Use hidden labels only for comparison after the service returns a result.

No paid model calls or image modifications were performed during this audit.
