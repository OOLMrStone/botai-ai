"""Self-contained record of one grading run, for sending to someone else.

A tester hits a bad grade and mails a file. That file has to answer, without
them present and without access to their machine:

* what was sent (photo, statement, every rendered prompt);
* what came back (raw model text, parsed objects, both grades);
* what it cost and how long each stage took;
* which models, prompt versions and settings produced it.

Only stage 1 sees the photograph, so a wrong grade is usually a wrong
*reading*. The report puts the transcript next to the grade to make that the
first thing you check.

**Secrets never enter a report.** Config is taken from `Settings.redacted()`,
which masks API keys and the debug token. Reports go to strangers by design;
this is the one place where "we can add masking later" would be a leak.
"""

from __future__ import annotations

import json
import logging
import platform
import sys
import threading
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config import Settings
from app.features import BY_KEY
from app.domain.schemas import PhotoGradeRequest, PhotoGradeResponse
from app.llm.pricing import CostBreakdown
from app.llm.pricing import total as total_cost

REPORT_VERSION = 2

logger = logging.getLogger(__name__)


class TesterFeedback(BaseModel):
    """What the tester thought, stored next to what the model produced.

    The point of a test round is disagreements between the two. A report
    without the tester's verdict records only what the machine did, which
    leaves the reader guessing whether it was right.
    """

    verdict: Literal["ok", "wrong", "unsure"] = "unsure"
    comment: str = ""
    expected_base: int | None = None
    expected_presentation: int | None = None
    tester: str = ""
    submitted_at: str = ""


class StageRecord(BaseModel):
    """One model call, with both halves of the conversation."""

    model_config = {"protected_namespaces": ()}

    stage: str
    label: str = ""
    index: int = 0
    provider: str = ""
    model: str = ""
    mocked: bool = False
    prompt: str = ""
    prompt_chars: int = 0
    raw_output: str | None = None
    parsed_output: dict[str, Any] | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    cost: CostBreakdown = Field(default_factory=CostBreakdown)
    latency_ms: int = 0
    attempts: int = 1
    structured_mode: str | None = None
    trace_id: str = ""
    notes: list[str] = Field(default_factory=list)
    error: str | None = None


class RunReport(BaseModel):
    report_version: int = REPORT_VERSION
    request_id: str
    created_at: str
    ok: bool = True
    error: dict[str, Any] | None = None

    task_number: int | None = None
    statement: str = ""
    reference_answer: str | None = None
    # Filenames and sizes only. The photograph is attached separately and by
    # choice: it is the biggest thing in the run and the most personal.
    images: list[dict[str, Any]] = Field(default_factory=list)
    image_data_urls: list[str] = Field(default_factory=list)
    solution_text: str | None = None

    grades: dict[str, Any] | None = None
    transcript: str | None = None
    findings: list[dict[str, Any]] = Field(default_factory=list)

    stages: list[StageRecord] = Field(default_factory=list)
    total_latency_ms: int = 0
    total_usage: dict[str, Any] = Field(default_factory=dict)
    total_cost: CostBreakdown = Field(default_factory=CostBreakdown)

    # Which toggles were on, and which of those differ from the registry
    # defaults. Two reports are only comparable if you know what differed.
    features: dict[str, bool] = Field(default_factory=dict)
    features_changed: dict[str, bool] = Field(default_factory=dict)

    feedback: TesterFeedback | None = None

    prompt_versions: dict[str, str] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class ReportBuilder:
    """Accumulates one run. Fed from the same hooks that drive the SSE stream."""

    def __init__(
        self,
        request: PhotoGradeRequest,
        settings: Settings,
        library: Any = None,
        request_id: str = "",
    ) -> None:
        self._t0 = time.perf_counter()
        self._settings = settings
        self._library = library
        self._request = request
        self._stages: list[StageRecord] = []
        self._notes: list[str] = []
        self._error: dict[str, Any] | None = None
        self._request_id = request_id
        self._features: dict[str, bool] = {}
        self._features_changed: dict[str, bool] = {}

    def observe(self, event: str, payload: dict[str, Any]) -> None:
        """Follow the progress stream.

        `stage_done` is deliberately not handled here: `_finished` calls
        `stage_done()` directly with the full prompt and output, which the
        emitted event may have had trimmed out.
        """
        if event == "started":
            self.started(payload)
            self._features = payload.get("features") or {}
            self._features_changed = payload.get("features_changed") or {}
        elif event == "stage_skipped":
            self.note(f"этап «{payload.get('stage')}» пропущен: {payload.get('reason')}")
        elif event == "log":
            self.note(payload.get("message", ""))
        elif event == "error":
            self.failed(payload.get("code", "unknown"), payload.get("message", ""))

    def started(self, payload: dict[str, Any]) -> None:
        self._request_id = payload.get("request_id", "")

    def stage_done(self, payload: dict[str, Any]) -> None:
        prompt = payload.get("prompt") or ""
        self._stages.append(
            StageRecord(
                stage=payload.get("stage", ""),
                label=payload.get("label", ""),
                index=payload.get("index", 0),
                provider=payload.get("provider", ""),
                model=payload.get("model", ""),
                mocked=payload.get("mocked", False),
                prompt=prompt,
                prompt_chars=len(prompt),
                raw_output=payload.get("raw_output"),
                parsed_output=payload.get("output"),
                usage=payload.get("usage") or {},
                cost=CostBreakdown(**(payload.get("cost") or {})),
                latency_ms=payload.get("latency_ms", 0),
                attempts=payload.get("attempts", 1),
                structured_mode=payload.get("structured_mode"),
                trace_id=payload.get("trace_id", ""),
                notes=payload.get("notes") or [],
            )
        )

    def note(self, message: str) -> None:
        self._notes.append(message)

    def failed(self, code: str, message: str) -> None:
        self._error = {"code": code, "message": message}

    def build(self, result: PhotoGradeResponse | None, include_images: bool = True) -> RunReport:
        request = self._request
        self._attach_raw_output()
        grades = transcript = None
        findings: list[dict[str, Any]] = []

        if result is not None:
            dumped = result.model_dump(mode="json")
            grades = {
                key: dumped[key]
                for key in (
                    "base", "presentation", "points_at_risk", "max_score", "summary",
                    "risk_comment", "how_to_protect_points", "how_to_raise_base", "confidence",
                )
                if key in dumped
            }
            if result.reconstruction is not None:
                transcript = result.reconstruction.to_prompt_text()
            if result.analysis is not None:
                findings = [f.model_dump(mode="json") for f in result.analysis.findings]

        usage_total: dict[str, Any] = {}
        if result is not None:
            usage_total = result.total_usage.model_dump(mode="json")

        return RunReport(
            request_id=self._request_id or (result.request_id if result else "unknown"),
            created_at=datetime.now(UTC).isoformat(timespec="seconds"),
            ok=self._error is None and result is not None,
            error=self._error,
            task_number=request.task_number,
            statement=request.statement,
            reference_answer=request.reference_answer,
            images=[_describe_image(u, i) for i, u in enumerate(request.images)],
            image_data_urls=list(request.images) if include_images else [],
            solution_text=request.solution_text,
            grades=grades,
            transcript=transcript,
            findings=findings,
            stages=self._stages,
            total_latency_ms=int((time.perf_counter() - self._t0) * 1000),
            total_usage=usage_total,
            total_cost=total_cost([s.cost for s in self._stages]),
            features=self._features,
            features_changed=self._features_changed,
            prompt_versions=self._prompt_versions(),
            config=_safe_config(self._settings),
            environment={
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "report_version": REPORT_VERSION,
            },
            notes=_dedupe([*self._notes, *(result.notes if result else [])]),
        )

    def _attach_raw_output(self) -> None:
        """Pull each call's literal response text out of the trace recorder.

        Kept out of the event payload because the browser already receives the
        parsed object, and the raw text only matters when parsing was the
        thing that went wrong — which is exactly when someone opens a report.
        """
        from app.llm.recorder import get_recorder

        recorder = get_recorder()
        for stage in self._stages:
            if not stage.trace_id:
                continue
            trace = recorder.get(stage.trace_id)
            if trace is not None:
                stage.raw_output = trace.response_text
                if trace.error and not stage.error:
                    stage.error = trace.error

    def _prompt_versions(self) -> dict[str, str]:
        """Which prompt file produced this, so a regression maps to an edit."""
        if self._library is None:
            return {}
        versions: dict[str, str] = {}
        for name in ("stage1_reconstruction", "stage2_analysis", "stage3_grading"):
            try:
                versions[name] = str(self._library.get(name).version)
            except Exception:  # noqa: BLE001 - a missing version must not sink the report
                continue
        return versions


def _dedupe(notes: list[str]) -> list[str]:
    """Keep the first occurrence of each note, in order.

    A post-processing correction reaches the builder twice: once as a `log`
    event while the run is in flight, and again inside the finished response's
    own `notes`. One of them is prefixed, so they are not literally equal —
    strip the prefix before comparing, or the duplicate survives and a
    benchmark log reads as if the correction happened twice.
    """
    seen: set[str] = set()
    out: list[str] = []
    for note in notes:
        key = note.removeprefix("постобработка: ").strip()
        if key in seen:
            continue
        seen.add(key)
        out.append(note)
    return out


def _describe_image(data_url: str, index: int) -> dict[str, Any]:
    media = "unknown"
    if data_url.startswith("data:"):
        media = data_url[5 : data_url.find(";")] or "unknown"
    return {"index": index, "media_type": media, "approx_bytes": int(len(data_url) * 3 / 4)}


def _safe_config(settings: Settings) -> dict[str, Any]:
    """Effective config with every secret already masked."""
    config = settings.redacted()
    return {
        "llm": config.get("llm", {}),
        "effective_vision": config.get("effective_vision", {}),
        "grading": config.get("grading", {}),
        "app": {k: v for k, v in config.get("app", {}).items() if k != "cors_origins"},
    }


# --- rendering ------------------------------------------------------------
def to_markdown(report: RunReport) -> str:
    """A skim-readable version, for pasting into an issue.

    The JSON is the artefact; this is for humans deciding whether to open it.
    """
    out: list[str] = []
    add = out.append

    add(f"# Отчёт о проверке · {report.request_id}")
    add("")
    if report.feedback is not None:
        fb = report.feedback
        label = {"ok": "оценка верна", "wrong": "ОЦЕНКА НЕВЕРНА", "unsure": "не уверен"}
        add(f"> **Тестировщик: {label.get(fb.verdict, fb.verdict)}**"
            + (f" — {fb.tester}" if fb.tester else ""))
        if fb.expected_base is not None or fb.expected_presentation is not None:
            add(f"> ожидал: за решение {fb.expected_base}, "
                f"с учётом оформления {fb.expected_presentation}")
        if fb.comment:
            add(f"> {fb.comment}")
        add("")
    add(f"- время: {report.created_at}")
    add(f"- задание: {report.task_number}")
    add(f"- статус: {'успешно' if report.ok else 'ОШИБКА'}")
    if report.error:
        add(f"- ошибка: `{report.error.get('code')}` — {report.error.get('message')}")
    if report.features_changed:
        flags = ", ".join(
            f"{k}={'вкл' if v else 'выкл'}" for k, v in sorted(report.features_changed.items())
        )
        add(f"- **нестандартные флаги: {flags}**")
    add(f"- всего: {report.total_latency_ms / 1000:.1f} с, "
        f"{report.total_usage.get('total_tokens', 0)} токенов, {_money(report.total_cost)}")
    add("")

    if report.grades:
        g = report.grades
        add("## Оценки")
        add("")
        add("| базовая (за математику) | с учётом оформления | под угрозой | из |")
        add("|---|---|---|---|")
        add(f"| {g['base']['score']} | {g['presentation']['score']} | "
            f"{g.get('points_at_risk')} | {g.get('max_score')} |")
        add("")
        add(f"**Итог.** {g.get('summary', '')}")
        add("")
        add(f"**Что под угрозой.** {g.get('risk_comment', '')}")
        add("")
        add(f"**Как защитить баллы.** {g.get('how_to_protect_points', '')}")
        add("")
        add(f"**Чего не хватило по математике.** {g.get('how_to_raise_base', '')}")
        add("")

    add("## Настройки прогона")
    add("")
    if report.features:
        add("| флаг | значение | по умолчанию |")
        add("|---|---|---|")
        for key, on in sorted(report.features.items()):
            changed = key in report.features_changed
            default = BY_KEY[key].default if key in BY_KEY else None
            mark = " **×**" if changed else ""
            add(f"| `{key}`{mark} | {'вкл' if on else 'выкл'} | "
                f"{'—' if default is None else ('вкл' if default else 'выкл')} |")
        add("")
        add("`×` — отличается от значения по умолчанию.")
    else:
        add("_флаги не записаны_")
    add("")
    if report.prompt_versions:
        add("Версии промптов: "
            + ", ".join(f"`{k}` v{v}" for k, v in sorted(report.prompt_versions.items())))
        add("")

    add("## Этапы")
    add("")
    add("| # | этап | модель | время | токены | стоимость | попыток |")
    add("|---|---|---|---|---|---|---|")
    for s in report.stages:
        add(f"| {s.index} | {s.stage} | `{s.model}` | {s.latency_ms / 1000:.1f} с | "
            f"{s.usage.get('total_tokens', 0)} | {_money(s.cost)} | {s.attempts} |")
    add("")

    if report.findings:
        add("## Находки")
        add("")
        for f in report.findings:
            add(f"- **{f.get('id')}** [{f.get('type')}/{f.get('severity')}] {f.get('what')}")
        add("")

    if report.transcript:
        add("## Что распознано на фотографии")
        add("")
        add("```")
        add(report.transcript)
        add("```")
        add("")

    if report.notes:
        add("## Заметки")
        add("")
        for n in report.notes:
            add(f"- {n}")
        add("")

    add("## Промпты и ответы")
    add("")
    for s in report.stages:
        add(f"<details><summary>{s.stage} · {s.model} · промпт {s.prompt_chars} симв.</summary>")
        add("")
        add("```")
        add(s.prompt)
        add("```")
        add("")
        if s.parsed_output is not None:
            add("```json")
            add(json.dumps(s.parsed_output, ensure_ascii=False, indent=2))
            add("```")
        add("")
        add("</details>")
        add("")

    return "\n".join(out)


def _money(cost: CostBreakdown) -> str:
    if cost.usd is None:
        return "—"
    if cost.source == "mock":
        return "$0 (mock)"
    suffix = {"table": " (оценка)", "partial": " (неполно)"}.get(cost.source, "")
    return f"${cost.usd:.4f}{suffix}"


# --- storage --------------------------------------------------------------
class ReportStore:
    """Recent runs: a bounded in-memory ring, optionally backed by disk.

    Memory alone is right for a laptop — a debugging aid, not an archive. It
    is wrong for a deployment testers use for days: the cap silently discards
    the older half of a test session and a restart discards all of it, which
    is precisely the evidence the exercise exists to collect.

    With `DEBUG_REPORTS_DIR` set, every run is also written as JSON under
    `<dir>/<YYYY-MM-DD>/<request_id>.json`. Plain files on purpose: a tester
    session should be collectable with `scp -r`, and readable in five years
    without this code.

    Reports contain student work. Nothing prunes this directory, so a real
    deployment needs a retention decision — see docs/DEPLOYMENT.md.
    """

    def __init__(self, limit: int = 20, directory: str | Path | None = None) -> None:
        self._items: deque[RunReport] = deque(maxlen=limit)
        self._lock = threading.Lock()
        self._dir = Path(directory) if directory else None
        if self._dir is not None:
            try:
                self._dir.mkdir(parents=True, exist_ok=True)
            except OSError:
                logger.exception("cannot create reports dir %s; memory only", self._dir)
                self._dir = None

    @property
    def directory(self) -> Path | None:
        return self._dir

    def add(self, report: RunReport) -> None:
        with self._lock:
            self._items.append(report)
        self._write(report)

    def get(self, request_id: str) -> RunReport | None:
        with self._lock:
            found = next((r for r in self._items if r.request_id == request_id), None)
        if found is not None:
            return found
        return self._read(request_id)

    def list(self, limit: int | None = None) -> list[RunReport]:
        """Newest first, from disk when there is one — memory is empty after a
        restart, and that is exactly when someone comes looking."""
        if self._dir is None:
            with self._lock:
                return list(reversed(self._items))

        paths = sorted(self._dir.rglob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        out: list[RunReport] = []
        for path in paths[: limit or 200]:
            report = self._load(path)
            if report is not None:
                out.append(report)
        return out

    def attach_feedback(self, request_id: str, feedback: TesterFeedback) -> RunReport | None:
        """Record what the tester thought of this grade, next to the grade."""
        report = self.get(request_id)
        if report is None:
            return None
        report.feedback = feedback
        with self._lock:
            for index, item in enumerate(self._items):
                if item.request_id == request_id:
                    self._items[index] = report
                    break
        self._write(report)
        return report

    # -- disk -------------------------------------------------------------
    def _path_for(self, report: RunReport) -> Path | None:
        if self._dir is None:
            return None
        day = (report.created_at or "")[:10] or "unknown"
        return self._dir / day / f"{report.request_id}.json"

    def _write(self, report: RunReport) -> None:
        path = self._path_for(report)
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Written atomically: a tester refreshing mid-write should never
            # collect a truncated file.
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(report.model_dump_json(indent=2), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            logger.exception("cannot persist report %s", report.request_id)

    def _read(self, request_id: str) -> RunReport | None:
        if self._dir is None:
            return None
        for path in self._dir.rglob(f"{request_id}.json"):
            return self._load(path)
        return None

    def _load(self, path: Path) -> RunReport | None:
        try:
            return RunReport.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - one bad file must not hide the rest
            logger.warning("skipping unreadable report %s", path)
            return None


_store: ReportStore | None = None


def get_report_store() -> ReportStore:
    global _store
    if _store is None:
        from app.config import get_settings

        debug = get_settings().debug
        _store = ReportStore(limit=debug.report_limit, directory=debug.reports_dir or None)
        if _store.directory:
            logger.info("reports persisted to %s", _store.directory)
    return _store


def reset_report_store() -> None:
    global _store
    _store = None
