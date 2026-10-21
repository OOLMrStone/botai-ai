"""Resolve shared and task prompts from one complete workspace layout.

Portable executables can sit beside common/ and numbered task folders. Runtime
images use prompts/<number>; checkouts use tasks/<number>/prompts. A selected
layout always supplies both shared and task files, with no fallback per file.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON_NAMES = ('main.md', 'analysis.md', 'grading.md', 'response-format.md')
PROMPT_NAMES = ('main.md', 'ocr.md', 'analysis.md', 'popular_mistakes.md',
                'grading.md', 'criteria.md', 'response-format.md')
# Project task number -> maximum score of the matching FIPI-2026 task (13, 14, 15, 16, 17, 18, 19).
MAX_SCORES = {14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4}
SUPPORTED_TASKS = frozenset(MAX_SCORES)
DEFAULT_TASK = 16
# Tasks whose photos are read by a separate literal call before grading (reader.py).
READER_TASKS = frozenset({14, 15, 16, 17, 18, 19, 20})
# Reader tasks graded in isolated stages (staged.py). Task 15 too since 16.10.2026: with the proof rules of 16.10 the
# stages gave 23 of 33 and every work fits in 6 minutes, while the old tool loop (24 of 33 on 03.10) now times out on
# 2 of 3 works (tasks/common/hypotheses/proof-acceptance-proposal.md).
STAGED_TASKS = frozenset({14, 15, 16, 17, 18, 19, 20})
# Reader tasks whose analysis and grading also get the student's «Ответ» line verbatim from the transcript.
ANSWER_LINE_TASKS = frozenset({15, 16, 17, 18, 19})
# Of those, tasks whose answer is a single value (part б of tasks 15 and 18, task 17), compared by value, not by intervals.
VALUE_ANSWER_TASKS = frozenset({15, 17, 18})
# Tasks whose response carries the expert-screen structure: ocr as steps, analysis statuses
# (app/grading/expert_json.py, docs/grading/expert-json.md). Staged tasks get it inside the stages,
# tool-loop tasks (15, 18) by structure.screen_response after the graded response.
EXPERT_JSON_TASKS = frozenset({14, 15, 16, 17, 18, 19, 20})
# Reader tasks whose photos are first turned upright (reader.upright). Off: on 14.10 it turned 7 of 36 upright
# photos of task 16 and missed two of three turned ones (tasks/16/evals/fix-2026-10-14.md).
ORIENT_TASKS = frozenset()
# Optional per-task files; a task without them keeps its package unchanged.
OPTIONAL_NAMES = ('ocr_biases.md',)
TASK_TITLES = {14: 'Уравнение', 15: 'Стереометрия', 16: 'Неравенство', 17: 'Экономическая задача',
               18: 'Планиметрия', 19: 'Задача с параметром', 20: 'Числа и их свойства'}


def response_format(text: str, max_score: int) -> str:
    """The common response-format.md names the 2-point scale of task 16; other maxima are put in its place.
    Without it task 19 (max 4) was graded on a "2-point scale": 4 became 2 and 3 became 1 (15.10.2026)."""
    if max_score == 2:
        return text
    scores = ', '.join(map(str, range(max_score))) + f' или {max_score}'
    return (text.replace('максимальный балл, для этого пакета 2', f'максимальный балл, для этого пакета {max_score}')
            .replace('Целое 0, 1 или 2', 'Целое ' + scores))


def task_max_score(task_number: int) -> int:
    if type(task_number) is not int or task_number not in MAX_SCORES:
        raise ValueError(f'Unsupported grading task: {task_number!r}')
    return MAX_SCORES[task_number]


def _directories(task_number: int, root: Path) -> tuple[Path, Path]:
    task_max_score(task_number)
    runtime = root / 'prompts' / str(task_number)
    if runtime.exists():
        return root / 'prompts' / 'common', runtime
    common, task = root / 'common', root / str(task_number)
    if common.exists() or task.exists():
        # Existing authoring folders may contain prompts/ alongside hypotheses
        # and evals. Select that shape as a whole, never from one folder only.
        if (common / 'prompts').exists() or (task / 'prompts').exists():
            return common / 'prompts', task / 'prompts'
        return common, task
    return root / 'tasks' / 'common' / 'prompts', root / 'tasks' / str(task_number) / 'prompts'


def task_directory(task_number: int = 16, *, root: Path = ROOT) -> Path:
    return _directories(task_number, root)[1]


def package_paths(task_number: int = 16, *, root: Path = ROOT) -> dict[str, Path]:
    common, task = _directories(task_number, root)
    return {name: (common if name in COMMON_NAMES else task) / name for name in PROMPT_NAMES}


def load_package(task_number: int = 16, *, root: Path = ROOT) -> dict[str, str]:
    package = {name: path.read_text(encoding='utf-8')
               for name, path in package_paths(task_number, root=root).items()}
    for name in OPTIONAL_NAMES:
        path = task_directory(task_number, root=root) / name
        if path.exists():
            package[name] = path.read_text(encoding='utf-8')
    return package
