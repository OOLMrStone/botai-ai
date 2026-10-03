"""Offline checks of the eval runner's task selection; no requests are sent."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('run_photo_evals', ROOT / 'scripts/run_photo_evals.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def manifest(tmp_path, **fields):
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps({'cases': [], **fields}))
    return path


@pytest.mark.parametrize('number', [14, 15, 18])
def test_task_number_from_repository_manifests(number):
    assert runner.manifest_task(ROOT / f'tasks/{number}/evals/fipi/manifest.json', None) == number


def test_task_number_defaults_to_16(tmp_path):
    assert runner.manifest_task(manifest(tmp_path), None) == 16
    assert runner.manifest_task(manifest(tmp_path), 18) == 18


def test_conflicting_or_unsupported_task_number(tmp_path):
    with pytest.raises(ValueError):
        runner.manifest_task(manifest(tmp_path, target_task_number=15), 18)
    with pytest.raises(ValueError):
        runner.manifest_task(manifest(tmp_path, target_task_number=17), None)
