"""The deployed package and authoring checkout resolve the same logical files."""
from pathlib import Path

import pytest

from app.grading.package import COMMON_NAMES, PROMPT_NAMES, load_package, package_paths
from app.grading.session import Session


def populate(root: Path, task_relative: str, marker: str) -> None:
    common_relative = 'prompts/common' if task_relative == 'prompts/16' else 'tasks/common/prompts'
    for name in PROMPT_NAMES:
        directory = root / (common_relative if name in COMMON_NAMES else task_relative)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / name).write_text(marker + ':' + name, encoding='utf-8')


@pytest.mark.parametrize('task_relative', ['tasks/16/prompts', 'prompts/16'])
def test_loads_checkout_and_runtime_layout(tmp_path, task_relative):
    populate(tmp_path, task_relative, 'approved')
    assert load_package(root=tmp_path) == {name: 'approved:' + name for name in PROMPT_NAMES}
    common = 'prompts/common' if task_relative == 'prompts/16' else 'tasks/common/prompts'
    assert package_paths(root=tmp_path)['main.md'] == tmp_path / common / 'main.md'
    assert package_paths(root=tmp_path)['analysis.md'] == tmp_path / common / 'analysis.md'
    (tmp_path / task_relative / 'analysis.md').write_text('stale task-specific analysis')
    assert load_package(root=tmp_path)['analysis.md'] == 'approved:analysis.md'


def test_runtime_package_wins_without_mixing_checkout_files(tmp_path):
    populate(tmp_path, 'tasks/16/prompts', 'checkout')
    populate(tmp_path, 'prompts/16', 'runtime')
    assert load_package(root=tmp_path)['analysis.md'] == 'runtime:analysis.md'
    (tmp_path / 'prompts/16/criteria.md').unlink()
    with pytest.raises(FileNotFoundError):
        load_package(root=tmp_path)


@pytest.mark.parametrize('task_number', [14, 15, 17, 18, 19, 20, '16', True])
def test_unsupported_task_does_not_fall_back_to_16(tmp_path, task_number):
    populate(tmp_path, 'tasks/16/prompts', 'approved')
    with pytest.raises(ValueError, match='Unsupported grading task'):
        load_package(task_number, root=tmp_path)
    with pytest.raises(ValueError, match='Unsupported grading task'):
        Session({'task_number': task_number}, [], {'main.md': 'provided'})


def test_missing_runtime_common_does_not_fall_back_to_checkout(tmp_path):
    populate(tmp_path, 'tasks/16/prompts', 'checkout')
    populate(tmp_path, 'prompts/16', 'runtime')
    (tmp_path / 'prompts/common/main.md').unlink()
    with pytest.raises(FileNotFoundError):
        load_package(root=tmp_path)
