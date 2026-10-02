"""Resolve one approved task package in a checkout or built runtime.

Runtime images put task prompts in prompts/<number>; authoring checkouts use
tasks/<number>/prompts and tasks/common/prompts. The response format is
task-specific (its maximum score differs), so only main and grading are common.
If the runtime task directory exists it selects the runtime layout for both
task and common files:
missing runtime files fail rather than silently mixing two versions.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON_NAMES = ('main.md', 'grading.md')
PROMPT_NAMES = ('main.md', 'ocr.md', 'analysis.md', 'popular_mistakes.md',
                'grading.md', 'criteria.md', 'response-format.md')
# Project task number -> maximum score of the matching FIPI-2026 task (13, 14, 15, 17).
MAX_SCORES = {14: 2, 15: 3, 16: 2, 18: 3}
SUPPORTED_TASKS = frozenset(MAX_SCORES)
# Tasks whose photos are transcribed before the reference answer is shown.
TRANSCRIPT_TASKS = frozenset({14, 15, 18})
DEFAULT_TASK = 16
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
    # A task may override a common file (transcript-first tasks have their own main.md).
    return {name: (common if name in COMMON_NAMES and not (task / name).exists() else task) / name
            for name in PROMPT_NAMES}


def load_package(task_number: int = 16, *, root: Path = ROOT) -> dict[str, str]:
    return {name: path.read_text(encoding='utf-8')
            for name, path in package_paths(task_number, root=root).items()}
