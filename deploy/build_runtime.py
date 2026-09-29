#!/usr/bin/env python3
"""Export a runtime-only deployment tree without credentials or research data."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'__pycache__', '.pytest_cache', '.ruff_cache', '.DS_Store'}


def export_runtime(destination: Path, source: Path = ROOT) -> dict[str, str]:
    source = source.resolve()
    destination = destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError('Output must be outside the repository')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('Output must be a new or empty directory')
    planned: dict[Path, Path] = {}

    def collect(folder: Path, target: Path, markdown_only: bool = False) -> None:
        if not folder.is_dir():
            raise ValueError(f'Missing runtime directory: {folder.relative_to(source)}')
        for path in sorted(folder.rglob('*')):
            relative = path.relative_to(folder)
            if any(part in EXCLUDED or part.startswith('.') for part in relative.parts):
                continue
            if path.is_symlink():
                raise ValueError(f'Symlinks are not allowed in runtime inputs: {path}')
            if not path.is_file() or path.suffix in {'.pyc', '.pyo'}:
                continue
            if markdown_only and (path.suffix != '.md' or path.name in {'README.md', 'AGENTS.md'}):
                continue
            planned[target / relative] = path

    collect(source / 'app', Path('app'))
    collect(source / 'tasks/common/prompts', Path('prompts/common'), True)
    collect(source / 'prompts/legacy', Path('prompts/legacy'), True)
    for number in range(14, 21):
        collect(source / 'tasks' / str(number) / 'prompts', Path('prompts') / str(number), True)
    for target, original in {
        'requirements.txt': 'requirements.txt',
        'Dockerfile': 'deploy/Dockerfile.runtime',
        'deploy/docker-compose.prod.yml': 'deploy/docker-compose.prod.yml',
    }.items():
        path = source / original
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or unsafe runtime input: {original}')
        planned[Path(target)] = path
    destination.mkdir(parents=True, exist_ok=True)
    for group in ('common', 'legacy', *(str(number) for number in range(14, 21))):
        (destination / 'prompts' / group).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for relative, original in sorted(planned.items()):
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, output)
        output.chmod(0o644)
        hashes[relative.as_posix()] = hashlib.sha256(output.read_bytes()).hexdigest()
    # The manifest describes every payload file; it cannot include its own hash.
    (destination / 'manifest.json').write_text(json.dumps(
        {'schema_version': 1, 'algorithm': 'sha256', 'files': hashes},
        indent=2, sort_keys=True) + '\n', encoding='utf-8')
    return hashes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New or empty output directory outside the repository')
    args = parser.parse_args()
    try:
        hashes = export_runtime(args.output)
    except ValueError as exc:
        parser.error(str(exc))
    print(f'Exported {len(hashes)} runtime files to {args.output.resolve()}')


if __name__ == '__main__':
    main()
