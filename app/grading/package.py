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
# Project task numbering and score scale, independent of legacy rubrics.
# A known number is not an approved production handler or a complete package.
MAX_SCORES = {14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4}
SUPPORTED_TASKS = frozenset(MAX_SCORES)


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
    return {name: path.read_text(encoding='utf-8')
            for name, path in package_paths(task_number, root=root).items()}
