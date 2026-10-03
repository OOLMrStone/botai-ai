"""The deployed package and authoring checkout resolve the same logical files."""
from pathlib import Path

import pytest

from app.grading.package import (COMMON_NAMES, MAX_SCORES, PROMPT_NAMES, ROOT, TRANSCRIPT_TASKS,
                                 load_package, package_paths)
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


def test_runtime_package_wins_without_mixing_checkout_files(tmp_path):
    populate(tmp_path, 'tasks/16/prompts', 'checkout')
    populate(tmp_path, 'prompts/16', 'runtime')
    assert load_package(root=tmp_path)['analysis.md'] == 'runtime:analysis.md'
    (tmp_path / 'prompts/16/criteria.md').unlink()
    with pytest.raises(FileNotFoundError):
        load_package(root=tmp_path)


@pytest.mark.parametrize('task_number', [13, 17, 19, 20, '16', True])
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


def test_max_scores_follow_fipi_2026():
    # Project numbers are FIPI-2026 numbers plus one: 13 and 15 score 2, 14 and 17 score 3.
    assert MAX_SCORES == {14: 2, 15: 3, 16: 2, 18: 3}


@pytest.mark.parametrize('task_number', sorted(MAX_SCORES))
def test_each_task_reads_its_own_response_format(task_number):
    paths = package_paths(task_number)
    task_folder = ROOT / 'tasks' / str(task_number) / 'prompts'
    assert paths['response-format.md'] == task_folder / 'response-format.md'
    assert 'response-format.md' not in COMMON_NAMES
    package = load_package(task_number)
    assert f'для этого пакета {MAX_SCORES[task_number]}' in package['response-format.md']


@pytest.mark.parametrize('task_number', sorted(MAX_SCORES))
def test_transcript_tasks_override_main_and_task_16_keeps_common(task_number):
    paths = package_paths(task_number)
    task_folder = ROOT / 'tasks' / str(task_number) / 'prompts'
    if task_number in TRANSCRIPT_TASKS:
        assert paths['main.md'] == task_folder / 'main.md'
        assert 'Transcript.md' in load_package(task_number)['main.md']
    else:
        assert paths['main.md'] == ROOT / 'tasks' / 'common' / 'prompts' / 'main.md'
    assert paths['grading.md'] == ROOT / 'tasks' / 'common' / 'prompts' / 'grading.md'
