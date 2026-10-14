"""Resolve one approved task package in a checkout or built runtime.

Runtime images put task prompts in prompts/<number>; authoring checkouts use
tasks/<number>/prompts and tasks/common/prompts. If the runtime task
directory exists it selects the runtime layout for both task and common files:
missing runtime files fail rather than silently mixing two versions.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON_NAMES = ('main.md', 'analysis.md', 'grading.md', 'response-format.md')
PROMPT_NAMES = ('main.md', 'ocr.md', 'analysis.md', 'popular_mistakes.md',
                'grading.md', 'criteria.md', 'response-format.md')
# Project task number -> maximum score of the matching FIPI-2026 task (13, 14, 15, 17).
MAX_SCORES = {14: 2, 15: 3, 16: 2, 18: 3}
SUPPORTED_TASKS = frozenset(MAX_SCORES)
DEFAULT_TASK = 16
# Tasks whose photos are read by a separate literal call before grading (reader.py).
READER_TASKS = frozenset({14, 16})
# Reader tasks whose analysis and grading also get the student's «Ответ» line verbatim from the transcript.
ANSWER_LINE_TASKS = frozenset({16})
# Reader tasks whose photos are first turned upright (reader.upright). Off: on 14.10 it turned 7 of 36 upright
# photos of task 16 and missed two of three turned ones (tasks/16/evals/fix-2026-10-14.md).
ORIENT_TASKS = frozenset()
# Optional per-task files; a task without them keeps its package unchanged.
OPTIONAL_NAMES = ('ocr_biases.md',)
TASK_TITLES = {14: 'Уравнение', 15: 'Стереометрия', 16: 'Неравенство', 18: 'Планиметрия'}


def task_directory(task_number: int = 16, *, root: Path = ROOT) -> Path:
    if type(task_number) is not int or task_number not in SUPPORTED_TASKS:
        raise ValueError(f'Unsupported grading task: {task_number!r}')
    runtime = root / 'prompts' / str(task_number)
    return runtime if runtime.exists() else root / 'tasks' / str(task_number) / 'prompts'


def package_paths(task_number: int = 16, *, root: Path = ROOT) -> dict[str, Path]:
    task = task_directory(task_number, root=root)
    runtime_layout = task == root / 'prompts' / str(task_number)
    common = root / 'prompts' / 'common' if runtime_layout else root / 'tasks' / 'common' / 'prompts'
    return {name: (common if name in COMMON_NAMES else task) / name for name in PROMPT_NAMES}


def load_package(task_number: int = 16, *, root: Path = ROOT) -> dict[str, str]:
    package = {name: path.read_text(encoding='utf-8')
               for name, path in package_paths(task_number, root=root).items()}
    for name in OPTIONAL_NAMES:
        path = task_directory(task_number, root=root) / name
        if path.exists():
            package[name] = path.read_text(encoding='utf-8')
    return package
