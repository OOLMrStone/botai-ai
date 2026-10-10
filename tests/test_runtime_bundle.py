"""Runtime exports preserve required inputs while excluding private artifacts."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

MODULE = Path(__file__).resolve().parents[1] / 'deploy/build_runtime.py'
spec = importlib.util.spec_from_file_location('build_runtime', MODULE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def source_tree(tmp_path):
    source = tmp_path / 'source'
    files = {
        'app/main.py': '# app', 'app/__pycache__/main.pyc': 'private',
        'tasks/common/prompts/main.md': 'shared', 'prompts/legacy/stage.md': 'legacy',
        'tasks/common/prompts/analysis.md': 'analysis',
        'tasks/16/prompts/README.md': 'documentation',
        'tasks/16/evals/student.jpg': 'private', '.env': 'private',
        'requirements.txt': 'fastapi', 'deploy/Dockerfile.runtime': 'FROM python:3.14-slim',
        'deploy/docker-compose.prod.yml': 'services: {}',
    }
    for name, text in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    for number in range(14, 21):
        (source / 'tasks' / str(number) / 'prompts').mkdir(parents=True, exist_ok=True)
    return source


def test_runtime_export_allowlist_and_hashes(tmp_path):
    source = source_tree(tmp_path)
    output = tmp_path / 'runtime'
    hashes = builder.export_runtime(output, source)
    assert set(hashes) == {
        'app/main.py', 'prompts/common/main.md', 'prompts/legacy/stage.md',
        'prompts/common/analysis.md', 'requirements.txt', 'Dockerfile',
        'deploy/docker-compose.prod.yml',
    }
    assert all((output / 'prompts' / str(n)).is_dir() for n in range(14, 21))
    assert json.loads((output / 'manifest.json').read_text())['files'] == hashes
    assert all(hashlib.sha256((output / name).read_bytes()).hexdigest() == value
               for name, value in hashes.items())
    with pytest.raises(ValueError, match='empty'):
        builder.export_runtime(output, source)
    with pytest.raises(ValueError, match='outside'):
        builder.export_runtime(source / 'export', source)


def test_runtime_export_rejects_symlinks_before_writing(tmp_path):
    source = source_tree(tmp_path)
    (source / 'app/secret.py').symlink_to(source / '.env')
    output = tmp_path / 'runtime'
    with pytest.raises(ValueError, match='Symlinks'):
        builder.export_runtime(output, source)
    assert not output.exists()
