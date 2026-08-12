"""Reads `prompts/*.md`, resolves includes, substitutes variables.

Deliberately not Jinja2. The templates are edited by people who are thinking
about marking criteria, not about a template language, and the only two
features needed are `{{ variable }}` and `{% include path %}`. A full engine
would also bring an execution model, which is the last thing you want pointed
at text that arrives from a photograph of a stranger's exam paper.

Rendering is **single-pass**: a value substituted into the template is never
re-scanned, so a student solution containing `{{ ... }}` or `{% include ... %}`
is inserted literally. That property is load-bearing — do not replace this
with repeated passes.
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger(__name__)

_FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_INCLUDE = re.compile(r"\{%\s*include\s+([^\s%}]+)\s*%\}")
_VARIABLE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_SECTION = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
# `{% if key %}` … `{% else %}` … `{% endif %}` — feature-gated passages.
_BLOCK = re.compile(r"\{%\s*(if|else|endif)(?:\s+([a-zA-Z_][a-zA-Z0-9_]*))?\s*%\}")

_MAX_INCLUDE_DEPTH = 8


class PromptError(RuntimeError):
    """Raised for a malformed template, a bad include, or a missing variable."""


@dataclass(frozen=True)
class Prompt:
    id: str
    version: str
    description: str
    required: tuple[str, ...]
    body: str
    path: Path
    meta: dict[str, str] = field(default_factory=dict)

    @property
    def placeholders(self) -> set[str]:
        """Every `{{ name }}` appearing in the body."""
        return set(_VARIABLE.findall(self.body))

    @property
    def sections(self) -> dict[str, str]:
        """Body split on `## Heading`, keyed by heading text.

        Lets one criteria file serve two stages: the rubric goes to stage 3,
        the failure modes to stage 2, without duplicating the file.
        """
        matches = list(_SECTION.finditer(self.body))
        out: dict[str, str] = {}
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(self.body)
            out[match.group(1)] = self.body[match.end() : end].strip()
        return out

    def section(self, name: str) -> str:
        try:
            return self.sections[name]
        except KeyError:
            raise PromptError(
                f"{self.path.name}: нет раздела '## {name}' (есть: {sorted(self.sections)})"
            ) from None

    @property
    def feature_keys(self) -> set[str]:
        """Every toggle this template branches on."""
        return {m.group(2) for m in _BLOCK.finditer(self.body) if m.group(1) == "if" and m.group(2)}

    def render(self, *, features: Mapping[str, bool] | None = None, **variables: Any) -> str:
        missing = [name for name in self.required if variables.get(name) in (None, "")]
        if missing:
            raise PromptError(
                f"{self.path.name}: не переданы обязательные переменные: {', '.join(missing)}"
            )

        # Conditionals collapse first, so a variable used only inside a
        # switched-off passage is not demanded — and so the branch that was
        # dropped can never contribute text.
        #
        # No feature map means the registry defaults, not "everything off": a
        # caller that does not care about toggles (a preview, a test) should
        # get the documented behaviour. A key absent from the registry is
        # still an error, so a typo in a template cannot silently disable a
        # passage.
        if features is None:
            from app.features import defaults

            features = defaults()
        body = _resolve_conditionals(self.body, features, self.path)

        unknown = set(_VARIABLE.findall(body)) - set(variables)
        if unknown:
            raise PromptError(
                f"{self.path.name}: в шаблоне есть {{{{ {' }}, {{ '.join(sorted(unknown))} }}}}, "
                "но значения не переданы. Опечатка в имени или забыт аргумент?"
            )

        # Single pass: re.sub never re-examines what it inserted.
        return _VARIABLE.sub(lambda m: str(variables[m.group(1)]), body)


class PromptLibrary:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._cache: dict[str, Prompt] = {}
        self._lock = threading.Lock()
        if not root.is_dir():
            raise PromptError(f"каталог с промптами не найден: {root}")

    def get(self, name: str) -> Prompt:
        """`name` is a path relative to the prompts root, with or without `.md`."""
        key = name if name.endswith(".md") else f"{name}.md"
        with self._lock:
            if key not in self._cache:
                self._cache[key] = self._load(key)
            return self._cache[key]

    def criteria(self, task_number: int) -> Prompt:
        return self.get(f"criteria/{task_number}")

    def names(self) -> list[str]:
        return sorted(
            str(p.relative_to(self.root)) for p in self.root.rglob("*.md") if p.name != "README.md"
        )

    def reload(self) -> None:
        with self._lock:
            self._cache.clear()

    # -- internals --------------------------------------------------------
    def _load(self, key: str) -> Prompt:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise PromptError(f"путь вне каталога промптов: {key}")
        if not path.is_file():
            raise PromptError(f"файл промпта не найден: {path}")

        raw = path.read_text(encoding="utf-8")
        match = _FRONTMATTER.match(raw)
        if match is None:
            raise PromptError(f"{path.name}: нет frontmatter-блока между --- и ---")

        meta = _parse_frontmatter(match.group(1), path)
        body = self._resolve_includes(raw[match.end() :].strip(), path, depth=0)

        # `criteria/13.md` declares `id: criteria_13`, so a bare stem match is
        # too strict; accept the `<folder>_<stem>` form too.
        prompt_id = meta.get("id", path.stem)
        if prompt_id not in {path.stem, f"{path.parent.name}_{path.stem}"}:
            logger.warning(
                "prompt id does not match filename",
                extra={"file": str(path), "id": prompt_id},
            )

        required = tuple(
            part.strip() for part in meta.get("required", "").split(",") if part.strip()
        )
        return Prompt(
            id=prompt_id,
            version=meta.get("version", "0"),
            description=meta.get("description", ""),
            required=required,
            body=body,
            path=path,
            meta=meta,
        )

    def _resolve_includes(self, body: str, origin: Path, depth: int) -> str:
        if depth > _MAX_INCLUDE_DEPTH:
            raise PromptError(f"{origin.name}: слишком глубокая вложенность include (цикл?)")

        def replace(match: re.Match[str]) -> str:
            target = (self.root / match.group(1)).resolve()
            if not target.is_relative_to(self.root.resolve()):
                raise PromptError(f"{origin.name}: include вне каталога промптов: {match.group(1)}")
            if not target.is_file():
                raise PromptError(f"{origin.name}: include не найден: {match.group(1)}")

            included = target.read_text(encoding="utf-8")
            fm = _FRONTMATTER.match(included)
            if fm is not None:
                included = included[fm.end() :]
            return self._resolve_includes(included.strip(), target, depth + 1)

        return _INCLUDE.sub(replace, body)


def _resolve_conditionals(body: str, features: Mapping[str, bool], path: Path) -> str:
    """Collapse `{% if key %}…{% else %}…{% endif %}`, innermost first.

    A hand-rolled scanner rather than a regex because these nest: stage 1 gates
    the drawing section, and passages inside it gate on other toggles. Regexes
    that "work" on nested blocks silently pair the wrong `endif`, which here
    would mean quietly shipping the wrong instructions to the model.

    An unknown key is an error, not a falsy default — a typo in a toggle name
    would otherwise switch a passage off for good with no sign of it.
    """
    while True:
        opens: list[re.Match[str]] = []
        replaced = False

        for match in _BLOCK.finditer(body):
            kind = match.group(1)
            if kind == "if":
                opens.append(match)
            elif kind == "endif":
                if not opens:
                    raise PromptError(f"{path.name}: {{% endif %}} без открывающего {{% if %}}")
                start = opens.pop()
                if opens:
                    continue  # not the innermost block yet
                inner = body[start.end() : match.start()]
                key = start.group(2)
                if not key:
                    raise PromptError(f"{path.name}: {{% if %}} без имени флага")
                if key not in features:
                    raise PromptError(
                        f"{path.name}: неизвестный флаг '{key}' в {{% if %}}; "
                        f"известны: {', '.join(sorted(features)) or '(нет)'}"
                    )
                kept = _pick_branch(inner, features[key], path)
                body = body[: start.start()] + kept + body[match.end() :]
                replaced = True
                break

        if not replaced:
            if opens:
                raise PromptError(
                    f"{path.name}: {{% if {opens[0].group(2)} %}} не закрыт {{% endif %}}"
                )
            return body


def _pick_branch(inner: str, enabled: bool, path: Path) -> str:
    """Split one block on its top-level `{% else %}` and keep the live half."""
    depth = 0
    for match in _BLOCK.finditer(inner):
        kind = match.group(1)
        if kind == "if":
            depth += 1
        elif kind == "endif":
            depth -= 1
        elif kind == "else" and depth == 0:
            head, tail = inner[: match.start()], inner[match.end() :]
            return (head if enabled else tail).strip("\n")
    return inner.strip("\n") if enabled else ""


def _parse_frontmatter(block: str, path: Path) -> dict[str, str]:
    meta: dict[str, str] = {}
    for number, line in enumerate(block.splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition(":")
        if not separator:
            raise PromptError(f"{path.name}: строка {number} frontmatter не вида 'key: value'")
        meta[key.strip()] = value.strip()
    return meta


_library: PromptLibrary | None = None


def default_root() -> Path:
    """`<repo>/prompts` — the package lives at `<repo>/app`."""
    from app.config import get_settings

    configured = get_settings().app.prompts_dir
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "prompts"


def get_prompt_library() -> PromptLibrary:
    global _library
    if _library is None:
        _library = PromptLibrary(default_root())
        logger.info("prompt library loaded", extra={"root": str(_library.root)})
    return _library


def reset_prompt_library() -> None:
    global _library
    _library = None
