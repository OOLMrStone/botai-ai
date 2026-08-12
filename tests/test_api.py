"""Public API surface."""

from __future__ import annotations

import pytest

from app.domain.tasks import PART_TWO_MAX_SCORE, TASK_REGISTRY


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llm_provider"] == "mock"


def test_ready_reports_capabilities(client):
    body = client.get("/health/ready").json()
    assert body["status"] == "ok"
    assert body["llm"]["configured"] is True
    assert "token_param" in body["llm"]["capabilities"]


def test_ready_with_live_probe(client):
    body = client.get("/health/ready", params={"probe": True}).json()
    assert body["llm"]["probe"]["ok"] is True


def test_ready_degrades_instead_of_erroring_without_an_api_key(monkeypatch):
    """A misconfigured provider must diagnose itself, not 500."""
    import os

    from fastapi.testclient import TestClient

    from app.config import get_settings, reset_settings_cache
    from app.llm import reset_llm_client

    monkeypatch.setitem(os.environ, "LLM_PROVIDER", "openai")
    monkeypatch.setitem(os.environ, "LLM_API_KEY", "")
    reset_settings_cache()
    reset_llm_client()

    from app.main import create_app

    with TestClient(create_app(get_settings())) as bare:
        response = bare.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["llm"]["configured"] is False
    assert "LLM_API_KEY" in body["llm"]["error"]
    # Liveness stays green: the process is fine, its config is not.
    assert bare.get("/health").status_code == 200


def test_request_id_is_echoed(client):
    response = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert response.headers["X-Request-ID"] == "abc-123"


# -- task registry ----------------------------------------------------------
def test_task_registry_covers_13_to_19(client):
    body = client.get("/api/v1/tasks").json()
    assert body["numbers"] == [13, 14, 15, 16, 17, 18, 19]
    assert body["part_two_max_score"] == PART_TWO_MAX_SCORE == 20


@pytest.mark.parametrize("number", sorted(TASK_REGISTRY))
def test_every_task_has_a_full_rubric(client, number):
    spec = client.get(f"/api/v1/tasks/{number}").json()
    points = {c["points"] for c in spec["criteria"]}
    assert points == set(range(spec["max_score"] + 1)), f"задание {number}: пропущены баллы"
    assert spec["grader_notes"]


def test_unknown_task_is_rejected(client):
    response = client.get("/api/v1/tasks/12")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_task"


# -- grading ----------------------------------------------------------------
def test_grade_returns_a_bounded_score(client, grade_payload):
    response = client.post("/api/v1/grade", json=grade_payload)
    assert response.status_code == 200

    body = response.json()
    assert body["task_number"] == 13
    assert body["max_score"] == 2
    assert 0 <= body["score"] <= 2
    assert body["meta"]["mocked"] is True
    assert body["meta"]["trace_ids"]
    assert body["request_id"].startswith("grade_")


def test_grade_rejects_empty_solution(client, grade_payload):
    response = client.post("/api/v1/grade", json={**grade_payload, "student_solution": ""})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_grade_rejects_out_of_part_two_task(client, grade_payload):
    response = client.post("/api/v1/grade", json={**grade_payload, "task_number": 5})
    assert response.status_code == 422
    assert response.json()["error"]["details"]["supported"] == [13, 14, 15, 16, 17, 18, 19]


def test_criteria_override_is_validated_against_max_score(client, grade_payload):
    response = client.post(
        "/api/v1/grade",
        json={
            **grade_payload,
            "max_score": 2,
            "criteria_override": [{"points": 5, "description": "слишком много"}],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"]["offending"] == [5]


def test_criteria_override_drives_the_rubric(client, grade_payload):
    response = client.post(
        "/api/v1/grade",
        json={
            **grade_payload,
            "criteria_override": [
                {"points": 2, "description": "всё верно"},
                {"points": 0, "description": "не верно"},
            ],
        },
    )
    assert response.status_code == 200
    # Only 0 and 2 are awardable now, so 1 must never come back.
    assert response.json()["score"] in (0, 2)


def test_batch_grading(client, grade_payload):
    response = client.post(
        "/api/v1/grade/batch",
        json={"items": [grade_payload, {**grade_payload, "task_number": 15}]},
    )
    assert response.status_code == 200

    body = response.json()
    assert body["total"] == 2
    assert body["succeeded"] == 2


def test_batch_isolates_a_failing_item(client, grade_payload):
    response = client.post(
        "/api/v1/grade/batch",
        json={"items": [grade_payload, {**grade_payload, "task_number": 99}]},
    )
    body = response.json()
    assert body["succeeded"] == 1
    assert body["failed"] == 1

    failed = next(item for item in body["items"] if not item["ok"])
    assert failed["error"]["code"] == "unknown_task"
