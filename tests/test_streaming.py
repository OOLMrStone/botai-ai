"""The SSE progress stream.

Grading takes minutes, so the browser needs to distinguish "still working"
from "hung". These tests pin the two things the page depends on: the event
sequence, and that the final `result` frame is the same object the plain
endpoint returns.
"""

from __future__ import annotations

import json

import pytest

from app.domain.schemas import PhotoGradeRequest
from app.grading.pipeline import get_pipeline


def parse_sse(body: str) -> list[tuple[str, dict]]:
    """`event:`/`data:` frames separated by a blank line; `:` lines are keepalives."""
    events = []
    for frame in body.split("\n\n"):
        if not frame.strip() or frame.startswith(":"):
            continue
        event, data = "message", ""
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if data:
            events.append((event, json.loads(data)))
    return events


@pytest.mark.anyio
async def test_emit_reports_every_stage_in_order():
    seen: list[tuple[str, dict]] = []

    async def emit(event, payload):
        seen.append((event, payload))

    await get_pipeline().run(
        PhotoGradeRequest(
            task_number=13,
            statement="Решите уравнение",
            solution_text="cos x = -1/2",
        ),
        emit=emit,
    )

    names = [e for e, _ in seen]
    assert names[0] == "started"
    assert "stage_skipped" in names  # text supplied, stage 1 not run
    assert names.count("stage_start") == names.count("stage_done") == 2
    # `report` trails `result`: the grade is what the caller waits on, the
    # report is the shareable record assembled once the grade exists.
    assert names.index("result") < names.index("report")
    assert names[-1] == "report"


@pytest.mark.anyio
async def test_stage_done_carries_prompt_and_output():
    """The stream is a debugging surface: it must expose what was actually sent."""
    seen = []

    async def emit(event, payload):
        seen.append((event, payload))

    await get_pipeline().run(
        PhotoGradeRequest(
            task_number=13, statement="Решите уравнение", solution_text="cos x = -1/2"
        ),
        emit=emit,
    )

    for event, payload in seen:
        if event == "stage_done":
            assert payload["prompt"], "prompt must not be empty"
            assert isinstance(payload["output"], dict)
            assert payload["index"] <= payload["total"]
            assert payload["trace_id"]


def test_run_without_emit_still_works(client):
    """Streaming is an observer. The plain endpoint must not depend on it."""
    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
        },
    )
    assert res.status_code == 200
    assert "base" in res.json()


def test_stream_endpoint_emits_result_frame(client):
    res = client.post(
        "/api/v1/grade/photo/stream",
        data={
            "task_number": "13",
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(res.text)
    names = [e for e, _ in events]
    assert names[0] == "started"
    assert "result" in names

    result = next(p for e, p in events if e == "result")
    for key in ("base", "presentation", "points_at_risk", "max_score", "summary"):
        assert key in result
    # Presentation can only cost points the maths already earned.
    assert result["base"]["score"] >= result["presentation"]["score"]
    assert result["points_at_risk"] == result["base"]["score"] - result["presentation"]["score"]


def test_stream_reports_errors_as_events_not_500(client):
    """A mid-stream failure must arrive as an `error` frame — headers are long gone."""
    res = client.post(
        "/api/v1/grade/photo/stream",
        data={"task_number": "99", "statement": "нет такого задания", "solution_text": "x=1"},
    )
    assert res.status_code == 200
    events = parse_sse(res.text)
    assert any(e == "error" for e, _ in events)
    error = next(p for e, p in events if e == "error")
    assert error["code"] and error["message"]
