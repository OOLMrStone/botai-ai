"""In-memory ring buffer of recent LLM calls.

Powers `GET /debug/llm/traces`: when a grade comes back wrong, the first
question is always "what exactly did we send and what came back".  Bounded by
`DEBUG_TRACE_LIMIT` so a long-running container cannot grow without limit.

Process-local by design -- this is a debugging aid, not an audit log.  Durable
history belongs in the datastore (see docs/ROADMAP.md).
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

from pydantic import BaseModel, Field

from app.llm.types import Message, Usage


class TraceRecord(BaseModel):
    model_config = {"protected_namespaces": ()}

    trace_id: str
    ts: float = Field(default_factory=time.time)
    request_id: str | None = None
    provider: str = "unknown"
    model: str = ""
    messages: list[Message] = Field(default_factory=list)
    # Vendor parameters actually sent (thinking switches, provider knobs). The
    # only place a toggle that changes no prompt text is visible at all.
    request_extra_body: dict[str, Any] | None = None
    response_text: str | None = None
    parsed: dict[str, Any] | None = None
    usage: Usage = Field(default_factory=Usage)
    latency_ms: int = 0
    attempts: int = 1
    structured_mode: str | None = None
    notes: list[str] = Field(default_factory=list)
    error: str | None = None


class TraceRecorder:
    def __init__(self, limit: int = 100, enabled: bool = True) -> None:
        self._items: deque[TraceRecord] = deque(maxlen=limit)
        self._lock = threading.Lock()
        self.enabled = enabled

    def record(self, item: TraceRecord) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._items.append(item)

    def list(self, limit: int = 20) -> list[TraceRecord]:
        with self._lock:
            items = list(self._items)
        return items[-limit:][::-1]

    def get(self, trace_id: str) -> TraceRecord | None:
        with self._lock:
            for item in reversed(self._items):
                if item.trace_id == trace_id:
                    return item
        return None

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        return len(self._items)


_recorder: TraceRecorder | None = None


def get_recorder() -> TraceRecorder:
    global _recorder
    if _recorder is None:
        from app.config import get_settings

        debug = get_settings().debug
        _recorder = TraceRecorder(limit=debug.trace_limit, enabled=debug.record_traces)
    return _recorder


def reset_recorder() -> None:
    global _recorder
    _recorder = None
