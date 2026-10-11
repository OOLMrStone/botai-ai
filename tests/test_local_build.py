"""Portable builds copy an explicit, complete public payload only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

import pytest

MODULE = Path(__file__).resolve().parents[1] / "scripts/build_local.py"
spec = importlib.util.spec_from_file_location("build_local", MODULE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def source_tree(tmp_path):
    source = tmp_path / "source"
    files = {
        **{path: "approved\r\nпромпт\n" for path in builder.PROMPT_FILES.values()},
        **{f"app/static/{name}": "public asset" for name in builder.STATIC_FILES},
        "scripts/run_local.py": "from app.local.launcher import main\nmain()\n",
        ".env": "private-key",
        "botai-local.json": '{"api_key": "private-key"}',
        "app/static/private.txt": "private-key",
        "tasks/common/prompts/hidden-answer.md": "private answer",
        "tasks/16/prompts/README.md": "private draft",
        "tasks/16/prompts/extra.md": "unapproved prompt",
        "tasks/16/evals/student.jpg": "private photograph",
        "tasks/17/prompts/README.md": "unapproved task documentation",
    }
    for name, content in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))
    return source


@pytest.mark.parametrize("system,executable_name", [("Windows", "BotAI-Local.exe"), ("Darwin", "BotAI-Local")])
def test_export_is_allowlisted_and_preserves_prompt_bytes(tmp_path, system, executable_name):
    source = source_tree(tmp_path)
    executable = tmp_path / "native"
    executable.write_bytes(b"fake executable")
    destination = tmp_path / "portable"
    hashes = builder.export_workspace(destination, executable, source=source, system=system)
    expected_prompts = {
        "common/main.md", "common/analysis.md", "common/grading.md",
        "common/response-format.md", "16/ocr.md", "16/criteria.md", "16/popular_mistakes.md",
    }
    assert set(builder.PROMPT_FILES) == expected_prompts
    expected = {*expected_prompts, executable_name, "README.txt"}
    if system == "Darwin":
        expected.add("Start.command")
    assert set(hashes) == expected
    for target, original in builder.PROMPT_FILES.items():
        assert (destination / target).read_bytes() == (source / original).read_bytes()
    assert (destination / "common").is_dir()
    assert all((destination / str(number)).is_dir() for number in range(14, 21))
    assert not (destination / "prompts").exists()
    assert not (destination / "tasks").exists()
    manifest = json.loads((destination / "manifest.json").read_text())
    assert manifest["files"] == hashes
    assert all(hashlib.sha256((destination / name).read_bytes()).hexdigest() == digest
               for name, digest in hashes.items())
    archive = builder.archive_workspace(destination)
    with zipfile.ZipFile(archive) as bundle:
        assert "portable/14/" in bundle.namelist()
        assert "portable/common/main.md" in bundle.namelist()
        assert "portable/16/ocr.md" in bundle.namelist()
        assert not any(name.startswith("portable/prompts/") for name in bundle.namelist())
        assert not any("private" in name or "evals" in name for name in bundle.namelist())
        if system == "Darwin":
            assert bundle.getinfo("portable/Start.command").external_attr >> 16 & 0o111
    with pytest.raises(ValueError, match="empty"):
        builder.export_workspace(destination, executable, source=source)


def test_missing_approved_prompt_fails_before_export(tmp_path):
    source = source_tree(tmp_path)
    (source / "tasks/16/prompts/ocr.md").unlink()
    with pytest.raises(ValueError, match="Incomplete task package 16.*ocr.md"):
        builder.export_workspace(tmp_path / "portable", tmp_path / "native", source=source)
    assert not (tmp_path / "portable").exists()


def test_export_includes_each_complete_package_without_borrowing_task_16(tmp_path):
    source = source_tree(tmp_path)
    for number in (14, 15, 17, 18, 19, 20):
        for name in builder.TASK_PROMPT_NAMES:
            path = source / f"tasks/{number}/prompts/{name}.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"synthetic task {number}: {name}\r\n".encode())
    executable = tmp_path / "native"
    executable.write_bytes(b"fake executable")
    destination = tmp_path / "portable"
    builder.export_workspace(destination, executable, source=source, system="Windows")
    for number in range(14, 21):
        for name in builder.TASK_PROMPT_NAMES:
            assert ((destination / str(number) / f"{name}.md").read_bytes()
                    == (source / f"tasks/{number}/prompts/{name}.md").read_bytes())
    assert not (destination / "17/README.md").exists()


def test_partial_optional_package_fails_before_writing(tmp_path):
    source = source_tree(tmp_path)
    (source / "tasks/17/prompts/criteria.md").write_text("synthetic partial package")
    with pytest.raises(ValueError, match="Incomplete task package 17.*ocr.md.*popular_mistakes.md"):
        builder.export_workspace(tmp_path / "portable", tmp_path / "native", source=source)
    assert not (tmp_path / "portable").exists()


def test_missing_task_packages_stay_empty_and_shared_files_remain_required(tmp_path):
    source = source_tree(tmp_path)
    for name in builder.TASK_PROMPT_NAMES:
        (source / f"tasks/16/prompts/{name}.md").unlink()
    assert set(builder.prompt_inputs(source)) == {
        "common/main.md", "common/analysis.md", "common/grading.md", "common/response-format.md",
    }
    executable = tmp_path / "native"
    executable.write_bytes(b"fake executable")
    destination = tmp_path / "portable"
    builder.export_workspace(destination, executable, source=source)
    assert all(not list((destination / str(number)).iterdir()) for number in range(14, 21))
    (source / "tasks/common/prompts/main.md").unlink()
    with pytest.raises(ValueError, match="Missing build input: tasks/common/prompts/main.md"):
        builder.prompt_inputs(source)


def test_symlinked_input_directory_fails_before_export(tmp_path):
    source = source_tree(tmp_path)
    original = source / "tasks/16/prompts"
    moved = tmp_path / "external"
    original.rename(moved)
    original.symlink_to(moved, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlinks"):
        builder.prompt_inputs(source)


def test_pyinstaller_data_allowlist_excludes_credentials(tmp_path):
    source = source_tree(tmp_path)
    stage = tmp_path / "stage"
    stage.mkdir()
    command = builder.pyinstaller_command(source, stage)
    data = [command[i + 1] for i, value in enumerate(command) if value == "--add-data"]
    assert len(data) == len(builder.STATIC_FILES)
    assert all(value.endswith(":app/static") for value in data)
    assert not (stage / "botai-local-defaults.json").exists()
    assert not list(stage.iterdir())
    assert not any("prompts" in value or ".env" in value for value in command)
