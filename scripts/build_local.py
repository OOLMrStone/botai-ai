#!/usr/bin/env python3
"""Build the native, portable local app without bundling private workspaces."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP_NAME = "BotAI-Local"
STATIC_FILES = ("index.html", "console.html", "local.js", "local.css")
PROMPT_FILES = {
    **{f"prompts/common/{name}.md": f"tasks/common/prompts/{name}.md"
       for name in ("main", "analysis", "grading", "response-format")},
    **{f"prompts/16/{name}.md": f"tasks/16/prompts/{name}.md"
       for name in ("ocr", "criteria", "popular_mistakes")},
}
START_COMMAND = '''#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
exec ./BotAI-Local "$@"
'''
PORTABLE_README = """BotAI Local — проверка напрямую через DeepSeek API

Windows: откройте BotAI-Local.exe.
macOS: откройте Start.command. Окно терминала держите открытым.
Форма откроется в браузере. Закрытие вкладки не выключает сервер;
для остановки нажмите Ctrl+C в окне программы или закройте это окно.

Программа читает prompts/common/*.md и prompts/16/*.md рядом с собой.
Вместо этой структуры можно положить executable в корень рабочего checkout,
где уже есть tasks/common/prompts и tasks/16/prompts. На macOS перенесите
вместе с ним Start.command. Только задание проекта 16 сейчас поддерживается.

Ключ встраивается отдельным шагом только в конечный исполняемый файл.
Не сохраняйте ключ в конфигурации, .env, исходниках или текстовых файлах.
Для проверки интерфейса без API запустите программу с аргументом --mock.
Проверка с настоящим ключом расходует средства вашего DeepSeek API.
Встроенный в executable ключ можно извлечь; распространяйте такой файл
только среди тех, кому доверяете пользоваться этим ключом.

Подробная инструкция: docs/LOCAL_APP.md в исходном репозитории.
"""


def safe_file(source: Path, relative: str) -> Path:
    """Reject both file links and parent-directory links before copying data."""
    path = source
    for part in Path(relative).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"Symlinks are not allowed in build inputs: {relative}")
    if not path.is_file():
        raise ValueError(f"Missing build input: {relative}")
    return path


def prompt_inputs(source: Path) -> dict[str, Path]:
    return {target: safe_file(source, original) for target, original in PROMPT_FILES.items()}


def static_inputs(source: Path) -> list[Path]:
    return [safe_file(source, f"app/static/{name}") for name in STATIC_FILES]


def validate_output(destination: Path, source: Path) -> None:
    if destination == source or destination in source.parents:
        raise ValueError("Output must not replace the repository or a parent directory")
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError("Output must be a new or empty directory")
    if destination.with_suffix(".zip").exists():
        raise ValueError("Output ZIP already exists; select a new output directory")


def pyinstaller_command(source: Path, stage: Path) -> list[str]:
    """Only explicitly allowed browser assets are additional application data."""
    assets = static_inputs(source)
    entrypoint = safe_file(source, "scripts/run_local.py")
    command = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
        "--name", APP_NAME, "--distpath", str(stage / "dist"),
        "--workpath", str(stage / "build"), "--specpath", str(stage),
        "--paths", str(source), "--collect-submodules", "uvicorn",
        "--copy-metadata", "openai", "--copy-metadata", "pydantic",
    ]
    for asset in assets:
        command.extend(["--add-data", f"{asset}:app/static"])
    command.append(str(entrypoint))
    return command


def export_workspace(destination: Path, executable: Path, *, source: Path = ROOT,
                     system: str | None = None) -> dict[str, str]:
    source, destination = source.resolve(), destination.resolve()
    validate_output(destination, source)
    prompts = prompt_inputs(source)
    if not executable.is_file() or executable.is_symlink():
        raise ValueError("Expected a native executable from PyInstaller")
    system = system or platform.system()
    if system not in ("Windows", "Darwin", "Linux"):
        raise ValueError(f"Unsupported build platform: {system}")
    name = APP_NAME + (".exe" if system == "Windows" else "")
    destination.mkdir(parents=True, exist_ok=True)
    for number in ("common", *(str(n) for n in range(14, 21))):
        (destination / "prompts" / number).mkdir(parents=True)
    for target, original in prompts.items():
        shutil.copyfile(original, destination / target)
    shutil.copyfile(executable, destination / name)
    (destination / name).chmod(0o755)
    if system == "Darwin":
        (destination / "Start.command").write_text(START_COMMAND, encoding="utf-8")
        (destination / "Start.command").chmod(0o755)
    (destination / "README.txt").write_text(PORTABLE_README, encoding="utf-8")
    hashes = {
        path.relative_to(destination).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(destination.rglob("*")) if path.is_file()
    }
    (destination / "manifest.json").write_text(json.dumps({
        "schema_version": 1, "platform": system, "architecture": platform.machine(),
        "algorithm": "sha256", "files": hashes,
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return hashes


def archive_workspace(destination: Path) -> Path:
    archive = destination.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
        # Include empty task directories and preserve executable permission bits.
        for path in sorted(destination.rglob("*")):
            output.write(path, Path(destination.name) / path.relative_to(destination))
    return archive


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" /
                        f"{APP_NAME}-{platform.system().lower()}-{platform.machine().lower()}",
                        help="New or empty portable output directory")
    args = parser.parse_args(argv)
    try:
        destination = args.output.resolve()
        validate_output(destination, ROOT)
        prompt_inputs(ROOT)
        with tempfile.TemporaryDirectory(prefix="botai-local-build-") as temporary:
            stage = Path(temporary)
            command = pyinstaller_command(ROOT, stage)
            subprocess.run(command, check=True, cwd=ROOT)
            filename = APP_NAME + (".exe" if platform.system() == "Windows" else "")
            hashes = export_workspace(destination, stage / "dist" / filename)
        archive = archive_workspace(destination)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Build failed: {exc}\n")
    print(f"Built {len(hashes)} portable files: {destination}")
    print(f"Archive: {archive}")
    print("Build contains no API key; embed credentials into the final executable separately.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
