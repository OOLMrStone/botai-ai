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
SUPPORTED_TASKS = frozenset({16})


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
    return {name: path.read_text(encoding='utf-8')
            for name, path in package_paths(task_number, root=root).items()}
