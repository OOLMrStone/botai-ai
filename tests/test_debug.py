"""Debug toolkit: the gate holds, and the tools do what they claim."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings, reset_settings_cache
from app.grading import reset_grading_service
from app.llm import reset_llm_client
from tests.conftest import DEBUG_HEADERS


# -- the gate ---------------------------------------------------------------
def test_debug_requires_a_token(client):
    assert client.get("/debug/ping").status_code == 403


def test_debug_rejects_a_wrong_token(client):
    assert client.get("/debug/ping", headers={"X-Debug-Token": "nope"}).status_code == 403


def test_debug_accepts_the_right_token(client):
    assert client.get("/debug/ping", headers=DEBUG_HEADERS).json() == {"pong": "ok"}


# -- the request console ----------------------------------------------------
def test_console_page_is_served(client):
    res = client.get("/ui/console.html")
    assert res.status_code == 200
    assert "X-Debug-Token" in res.text


def test_console_page_ships_no_token_of_its_own(client, settings):
    """It is a form for a secret, never a place to keep one.

    The page is static and therefore reachable with the toolkit off, so a
    token baked into it would be readable by anyone who can open the UI.
    """
    body = client.get("/ui/console.html").text
    assert settings.debug.token not in body
    assert "test-token" not in body


def test_console_page_does_not_weaken_the_gate(client):
    """Regression guard: opening the console must not open /debug with it."""
    assert client.get("/ui/console.html").status_code == 200
    assert client.get("/debug/ping").status_code == 403
    assert client.get("/debug/config").status_code == 403


@pytest.fixture
def no_debug_client(monkeypatch):
    """An app built with the toolkit switched off."""
    monkeypatch.setitem(os.environ, "DEBUG_ENABLED", "false")
    reset_settings_cache()
    reset_llm_client()
    reset_grading_service()

    from app.main import create_app

    with TestClient(create_app(get_settings())) as test_client:
        yield test_client


def test_debug_routes_vanish_when_disabled(no_debug_client):
    """404, not 403: a probe should not learn the surface exists."""
    assert no_debug_client.get("/debug/ping", headers=DEBUG_HEADERS).status_code == 404
    assert no_debug_client.get("/debug/config", headers=DEBUG_HEADERS).status_code == 404


def test_health_reports_the_toolkit_is_off(no_debug_client):
    assert no_debug_client.get("/health").json()["debug_tools"] is False


def test_force_score_is_ignored_when_toolkit_is_off(no_debug_client, grade_payload):
    response = no_debug_client.post(
        "/api/v1/grade", json={**grade_payload, "debug": {"force_score": 2}}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["provider"] != "debug"
    assert body["debug"] is None


def test_prod_env_refuses_to_enable_the_toolkit(monkeypatch):
    monkeypatch.setitem(os.environ, "APP_ENV", "prod")
    monkeypatch.setitem(os.environ, "DEBUG_ENABLED", "true")
    reset_settings_cache()
    assert get_settings().debug.enabled is False


def test_prod_env_can_be_overridden_explicitly(monkeypatch):
    monkeypatch.setitem(os.environ, "APP_ENV", "prod")
    monkeypatch.setitem(os.environ, "DEBUG_ENABLED", "true")
    monkeypatch.setitem(os.environ, "DEBUG_ALLOW_IN_PROD", "true")
    reset_settings_cache()
    assert get_settings().debug.enabled is True


def test_empty_token_disables_the_toolkit(monkeypatch):
    monkeypatch.setitem(os.environ, "DEBUG_TOKEN", "")
    reset_settings_cache()
    assert get_settings().debug.enabled is False


# -- config -----------------------------------------------------------------
def test_config_masks_secrets(client):
    body = client.get("/debug/config", headers=DEBUG_HEADERS).json()
    # Long enough for the partial mask; the point is the middle never appears.
    assert body["debug"]["token"] == "test...oken"
    assert "test-token" not in str(body)
    assert body["llm"]["provider"] == "mock"


def test_short_secrets_are_fully_masked(monkeypatch):
    monkeypatch.setitem(os.environ, "LLM_API_KEY", "sk-short")
    monkeypatch.setitem(os.environ, "LLM_PROVIDER", "openai")
    reset_settings_cache()
    assert get_settings().redacted()["llm"]["api_key"] == "***"


# -- prompt preview ---------------------------------------------------------
def test_preview_prompt_costs_nothing_and_shows_the_rubric(client, grade_payload, mock_provider):
    response = client.post(
        "/debug/grading/preview-prompt", headers=DEBUG_HEADERS, json=grade_payload
    )
    assert response.status_code == 200

    body = response.json()
    assert body["task"]["number"] == 13
    assert body["char_count"] > 0
    assert body["criteria_source"]

    joined = "\n".join(m["content"] for m in body["messages"])
    assert "Критерии оценивания" in joined
    assert "Обоснованно получены верные ответы в обоих пунктах" in joined
    assert grade_payload["student_solution"] in joined
    assert mock_provider.calls == []  # no model call happened


def test_preview_prompt_reflects_criteria_override(client, grade_payload):
    body = client.post(
        "/debug/grading/preview-prompt",
        headers=DEBUG_HEADERS,
        json={
            **grade_payload,
            "criteria_override": [{"points": 2, "description": "мой критерий"}],
        },
    ).json()
    joined = "\n".join(m["content"] for m in body["messages"])
    assert "мой критерий" in joined
    assert body["criteria_source"] is None


# -- forced grades ----------------------------------------------------------
def test_force_score_skips_the_model(client, grade_payload, mock_provider):
    response = client.post(
        "/api/v1/grade", json={**grade_payload, "debug": {"force_score": 1}}
    )
    body = response.json()

    assert body["score"] == 1
    assert body["meta"]["provider"] == "debug"
    assert body["debug"]["forced"] is True
    assert mock_provider.calls == []


def test_force_score_is_clamped_to_max(client, grade_payload):
    body = client.post(
        "/api/v1/grade", json={**grade_payload, "debug": {"force_score": 99}}
    ).json()
    assert body["score"] == 2
    assert body["verdict"] == "correct"


def test_return_prompt_and_raw(client, grade_payload):
    body = client.post(
        "/api/v1/grade",
        json={**grade_payload, "debug": {"return_prompt": True, "return_raw": True}},
    ).json()
    assert body["debug"]["prompt"][0]["role"] == "system"
    assert body["debug"]["raw_response"]


# -- traces -----------------------------------------------------------------
def test_traces_record_the_call(client, grade_payload):
    graded = client.post("/api/v1/grade", json=grade_payload).json()
    trace_id = graded["meta"]["trace_ids"][0]

    listing = client.get("/debug/llm/traces", headers=DEBUG_HEADERS).json()
    assert listing["stored"] >= 1

    detail = client.get(f"/debug/llm/traces/{trace_id}", headers=DEBUG_HEADERS).json()
    assert detail["trace_id"] == trace_id
    assert detail["parsed"] is not None
    assert "Критерии оценивания" in detail["messages"][1]["content"]


def test_traces_can_be_cleared(client, grade_payload):
    client.post("/api/v1/grade", json=grade_payload)
    client.delete("/debug/llm/traces", headers=DEBUG_HEADERS)
    assert client.get("/debug/llm/traces", headers=DEBUG_HEADERS).json()["stored"] == 0


def test_unknown_trace_is_404(client):
    assert client.get("/debug/llm/traces/nope", headers=DEBUG_HEADERS).status_code == 404


# -- mock control -----------------------------------------------------------
def test_mock_state_and_reset(client):
    state = client.get("/debug/llm/mock", headers=DEBUG_HEADERS).json()
    assert state["queued_replies"] == 0

    client.post("/debug/llm/mock/script", headers=DEBUG_HEADERS, json={"text": "привет"})
    assert client.get("/debug/llm/mock", headers=DEBUG_HEADERS).json()["queued_replies"] == 1

    client.delete("/debug/llm/mock", headers=DEBUG_HEADERS)
    assert client.get("/debug/llm/mock", headers=DEBUG_HEADERS).json()["queued_replies"] == 0


def test_script_demands_exactly_one_of_text_or_error(client):
    response = client.post(
        "/debug/llm/mock/script", headers=DEBUG_HEADERS, json={"text": "a", "error": "timeout"}
    )
    assert response.status_code == 422


def test_scripted_failure_is_visible_as_a_retry(client, grade_payload):
    client.post("/debug/llm/mock/script", headers=DEBUG_HEADERS, json={"error": "rate_limit"})

    body = client.post("/api/v1/grade", json=grade_payload).json()

    assert body["meta"]["attempts"] >= 2
    assert any("transient" in note for note in body["meta"]["notes"])


def test_echo_playground(client):
    body = client.post(
        "/debug/llm/echo",
        headers=DEBUG_HEADERS,
        json={"messages": [{"role": "user", "content": "скажи что-нибудь"}]},
    ).json()
    assert body["text"]
    assert body["meta"]["provider"] == "mock"


def test_echo_as_verdict(client):
    body = client.post(
        "/debug/llm/echo",
        headers=DEBUG_HEADERS,
        json={"messages": [{"role": "user", "content": "[[MOCK_SCORE=2]]"}], "as_verdict": True},
    ).json()
    assert body["value"]["score"] == 2


# -- samples ----------------------------------------------------------------
def test_samples_are_listed(client):
    body = client.get("/debug/samples", headers=DEBUG_HEADERS).json()
    assert "13_partial" in body
    assert body["13_partial"]["expected_score_hint"]


@pytest.mark.parametrize("name", ["13_partial", "16_model_error", "19_empty"])
def test_every_sample_grades_end_to_end(client, name):
    response = client.post(
        "/debug/grading/sample", headers=DEBUG_HEADERS, params={"name": name}
    )
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["score"] <= body["max_score"]


def test_unknown_sample_is_404(client):
    response = client.post(
        "/debug/grading/sample", headers=DEBUG_HEADERS, params={"name": "nope"}
    )
    assert response.status_code == 404
