"""Feature toggles: resolution, template gating, and reaching the prompt.

A toggle that silently fails to apply is worse than no toggle: a benchmark
then reports a comparison it never actually ran. These tests all use the mock
provider, so nothing here costs money.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.errors import ValidationError
from app.features import (
    BY_KEY,
    FEATURES,
    THINKING_ON,
    defaults,
    describe,
    non_default,
    request_extra_for,
    resolve,
)
from app.prompting import get_prompt_library
from app.prompting.loader import PromptError, _resolve_conditionals
from tests.conftest import DEBUG_HEADERS


# --- resolution -----------------------------------------------------------
def test_defaults_come_from_the_registry():
    assert defaults() == {f.key: f.default for f in FEATURES}


def test_request_override_beats_deployment_config():
    resolved = resolve(
        configured={"solve_independently": False},
        override={"solve_independently": True},
    )
    assert resolved["solve_independently"] is True


def test_deployment_config_beats_the_registry_default():
    assert resolve(configured={"solve_independently": False})["solve_independently"] is False


def test_unknown_key_is_rejected_at_every_layer():
    """A typo must not quietly do nothing — that is a silently wrong benchmark."""
    with pytest.raises(ValidationError):
        resolve(configured={"solve_independantly": False})  # codespell:ignore
    with pytest.raises(ValidationError):
        resolve(override={"nonsense": True})


def test_non_default_reports_only_the_deviations():
    active = {**defaults(), "solve_independently": False}
    assert non_default(active) == {"solve_independently": False}
    assert non_default(defaults()) == {}


def test_describe_exposes_what_the_ui_needs():
    for row in describe():
        assert row["key"] and row["title_ru"] and row["description_ru"]
        assert isinstance(row["enabled"], bool)
        assert row["stages"]


# --- template gating ------------------------------------------------------
@pytest.mark.parametrize(
    ("body", "features", "expected"),
    [
        ("A{% if x %}B{% endif %}C", {"x": True}, "ABC"),
        ("A{% if x %}B{% endif %}C", {"x": False}, "AC"),
        ("A{% if x %}B{% else %}D{% endif %}C", {"x": True}, "ABC"),
        ("A{% if x %}B{% else %}D{% endif %}C", {"x": False}, "ADC"),
        # nesting: the inner block must pair with the inner endif
        ("{% if a %}1{% if b %}2{% endif %}3{% endif %}", {"a": True, "b": False}, "13"),
        ("{% if a %}1{% if b %}2{% endif %}3{% endif %}", {"a": False, "b": True}, ""),
    ],
)
def test_conditionals_collapse(body, features, expected):
    assert _resolve_conditionals(body, features, Path("t.md")) == expected


@pytest.mark.parametrize(
    "body",
    ["{% if unknown %}x{% endif %}", "{% if a %}x", "x{% endif %}", "{% if %}x{% endif %}"],
)
def test_malformed_blocks_raise(body):
    with pytest.raises(PromptError):
        _resolve_conditionals(body, {"a": True}, Path("t.md"))


def test_variable_inside_a_disabled_block_is_not_required():
    """The dropped branch must not demand values for text nobody will see."""
    prompt = get_prompt_library().get("stage2_analysis")
    rendered = prompt.render(
        features={**defaults(), "use_reference_solution": False},
        task_number=13,
        task_topic="Уравнение",
        statement="S",
        reconstruction="R",
        task_pitfalls="P",
        reference_block="ЭТАЛОН",
    )
    assert "ЭТАЛОН" not in rendered


def test_render_without_features_uses_registry_defaults():
    prompt = get_prompt_library().get("stage2_analysis")
    bare = prompt.render(
        task_number=13, task_topic="У", statement="S",
        reconstruction="R", task_pitfalls="P", reference_block="",
    )
    explicit = prompt.render(
        features=defaults(),
        task_number=13, task_topic="У", statement="S",
        reconstruction="R", task_pitfalls="P", reference_block="",
    )
    assert bare == explicit


def test_every_flag_used_in_a_template_exists_in_the_registry():
    """Catches a toggle renamed in code but not in the .md, or vice versa."""
    library = get_prompt_library()
    for name in library.names():
        for key in library.get(name.removesuffix(".md")).feature_keys:
            assert key in BY_KEY, f"{name} branches on unknown flag '{key}'"


def test_every_registered_flag_is_used_by_the_stages_it_claims():
    library = get_prompt_library()
    for feature in FEATURES:
        if feature.request_extra:
            continue  # acts on the request body, so it has no `{% if %}`
        for stage in feature.stages:
            assert feature.key in library.get(stage).feature_keys, (
                f"{feature.key} claims {stage} but that template never branches on it"
            )


@pytest.mark.parametrize("feature", FEATURES, ids=lambda f: f.key)
def test_each_toggle_actually_changes_its_prompt(feature):
    """A toggle whose two states render identically is decoration."""
    if feature.request_extra:
        pytest.skip("changes the request body, not the prompt — covered below")
    library = get_prompt_library()
    samples = {
        "stage1_reconstruction": dict(task_number=17, task_topic="Планиметрия", statement="S"),
        "stage2_analysis": dict(
            task_number=13, task_topic="У", statement="S",
            reconstruction="R", task_pitfalls="P", reference_block="REF",
        ),
        "stage3_grading": dict(
            task_number=13, max_score=2, criteria="C", findings="F", analysis_summary="A",
        ),
    }
    for stage in feature.stages:
        prompt = library.get(stage)
        on = prompt.render(features={**defaults(), feature.key: True}, **samples[stage])
        off = prompt.render(features={**defaults(), feature.key: False}, **samples[stage])
        assert on != off, f"{feature.key} does not change {stage}"


# --- end to end (mock provider) ------------------------------------------
def test_overrides_reach_the_response_and_the_report(client):
    from app.reporting import get_report_store

    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
            "features": {"solve_independently": False},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["features"]["solve_independently"] is False
    assert any("нестандартные флаги" in n for n in body["notes"])

    report = get_report_store().get(body["request_id"])
    assert report is not None
    assert report.features_changed == {"solve_independently": False}


def test_unknown_override_is_a_422_not_a_silent_no_op(client):
    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "x=1",
            "features": {"not_a_real_flag": True},
        },
    )
    assert res.status_code == 422
    assert "not_a_real_flag" in res.json()["error"]["message"]


def test_features_endpoint_is_gated(client):
    assert client.get("/debug/features").status_code == 403
    assert client.get("/debug/features", headers=DEBUG_HEADERS).status_code == 200


def test_features_endpoint_lists_the_registry(client):
    body = client.get("/debug/features", headers=DEBUG_HEADERS).json()
    assert {f["key"] for f in body["features"]} == set(BY_KEY)


def test_feature_listing_needs_no_debug_token(client):
    """Regression: the panel fetched the gated endpoint with a guessed token,
    got 403 on the server (whose token is random), and hid itself."""
    res = client.get("/api/v1/features")
    assert res.status_code == 200
    assert {f["key"] for f in res.json()["features"]} == set(BY_KEY)


def test_public_and_debug_listings_agree(client):
    public = client.get("/api/v1/features").json()["features"]
    gated = client.get("/debug/features", headers=DEBUG_HEADERS).json()["features"]
    assert {f["key"]: f["enabled"] for f in public} == {f["key"]: f["enabled"] for f in gated}


# --- deep thinking: toggles that act on the request, not the prompt -------
DEEP = {
    "stage1_reconstruction": "deep_think_reconstruction",
    "stage2_analysis": "deep_think_analysis",
    "stage3_grading": "deep_think_grading",
}


def test_deep_thinking_is_off_by_default():
    for key in DEEP.values():
        assert defaults()[key] is False
    assert request_extra_for("stage2_analysis", defaults()) is None


@pytest.mark.parametrize(("stage", "key"), sorted(DEEP.items()))
def test_each_stage_has_its_own_thinking_switch(stage, key):
    on = {**defaults(), key: True}
    assert request_extra_for(stage, on) == THINKING_ON
    # and it reaches only that stage
    for other in DEEP:
        if other != stage:
            assert request_extra_for(other, on) is None


def test_thinking_reaches_the_provider_request(client):
    """The switch is only real if it is in the body that goes out."""
    from app.llm.recorder import get_recorder

    body = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
            "features": {"deep_think_grading": True},
        },
    ).json()

    sent = {}
    for stage in body["stages"]:
        trace = get_recorder().get(stage["trace_id"])
        assert trace is not None
        sent[stage["stage"]] = (trace.request_extra_body or {})

    assert sent["grading"].get("thinking") == THINKING_ON["thinking"]
    assert "thinking" not in sent["analysis"], "stage 2 must not inherit stage 3's switch"


# --- reconstruct_first: the one toggle that removes a stage ---------------
# A 1×1 PNG. The provider is the mock, so the pixels never matter — what
# matters is that a real `data:` image travels the whole path.
PIXEL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _photo(**extra: object) -> dict[str, object]:
    return {"task_number": 13, "statement": "Решите уравнение", "images": [PIXEL], **extra}


def _stage_names(body: dict) -> list[str]:
    return [s["stage"] for s in body["stages"]]


def test_a_photo_runs_all_three_stages_by_default(client):
    body = client.post("/api/v1/grade/photo", json=_photo()).json()
    assert _stage_names(body) == ["reconstruction", "analysis", "grading"]
    assert body["reconstruction"] is not None


def test_toggle_off_sends_the_photo_straight_to_analysis(client):
    body = client.post(
        "/api/v1/grade/photo", json=_photo(features={"reconstruct_first": False})
    ).json()
    assert _stage_names(body) == ["analysis", "grading"]
    assert body["reconstruction"] is None
    assert any("reconstruct_first" in note for note in body["notes"])


def test_toggle_off_says_that_stage_one_flags_stopped_applying(client):
    """Otherwise a benchmark reports toggles that silently did nothing."""
    body = client.post(
        "/api/v1/grade/photo", json=_photo(features={"reconstruct_first": False})
    ).json()
    note = next(n for n in body["notes"] if "флаги этапа 1" in n)
    assert "normalize_artifacts" in note and "describe_drawings" in note


def test_toggle_off_actually_puts_the_image_in_the_analysis_call(client):
    """The stage has to *receive* the photograph, not merely skip stage 1."""
    from app.llm.recorder import get_recorder

    body = client.post(
        "/api/v1/grade/photo", json=_photo(features={"reconstruct_first": False})
    ).json()
    analysis = next(s for s in body["stages"] if s["stage"] == "analysis")
    trace = get_recorder().get(analysis["trace_id"])
    assert trace is not None
    # Images are redacted in traces; the marker is what survives.
    assert any("<image image/png" in m.text for m in trace.messages)


def test_toggle_off_asks_the_prompt_to_read_the_handwriting(client):
    prompt = get_prompt_library().get("stage2_analysis")
    kwargs = dict(
        task_number=13, task_topic="Уравнение", statement="S",
        reconstruction="РАСШИФРОВКА", task_pitfalls="P", reference_block="",
    )
    direct = prompt.render(features={**defaults(), "reconstruct_first": False}, **kwargs)
    staged = prompt.render(features={**defaults(), "reconstruct_first": True}, **kwargs)

    assert "РАСШИФРОВКА" not in direct and "РАСШИФРОВКА" in staged
    assert "фотограф" in direct.lower()


def test_toggle_is_a_no_op_on_text_input(client):
    """There is no stage 1 to remove when the solution arrives as text."""
    payload = {
        "task_number": 13,
        "statement": "Решите уравнение",
        "solution_text": "cos x = -1/2",
    }
    off = client.post("/api/v1/grade/photo", json={**payload, "features": {"reconstruct_first": False}}).json()
    assert _stage_names(off) == ["analysis", "grading"]
    assert any("передано текстом" in n for n in off["notes"])
    assert not any("флаги этапа 1" in n for n in off["notes"])


# --- the two profiles must not bleed into each other ----------------------
@pytest.fixture
def staged_profiles(monkeypatch):
    """An app configured the way the DeepSeek deployment actually is.

    Stage 1 gets a small budget and thinking off — both right for reading
    handwriting, both wrong for a stage 2 that merely borrows the endpoint.
    Without distinct profiles the bug is invisible, which is why the original
    tests missed it.
    """
    import os

    from fastapi.testclient import TestClient

    from app.config import get_settings, reset_settings_cache
    from app.grading.pipeline import reset_pipeline
    from app.llm import reset_llm_client

    monkeypatch.setitem(os.environ, "LLM_MAX_OUTPUT_TOKENS", "32000")
    monkeypatch.setitem(os.environ, "LLM_VISION_MAX_OUTPUT_TOKENS", "8000")
    monkeypatch.setitem(os.environ, "LLM_VISION_EXTRA_BODY", '{"thinking":{"type":"disabled"}}')
    reset_settings_cache()
    reset_llm_client()
    reset_pipeline()

    from app.main import create_app

    with TestClient(create_app(get_settings())) as test_client:
        yield test_client


def _vision_calls():
    from app.grading.pipeline import get_pipeline

    return get_pipeline().vision.provider.calls


def test_stage_one_keeps_its_own_lean_profile(staged_profiles):
    """Guard the thing the fix must not break."""
    staged_profiles.post("/api/v1/grade/photo", json=_photo())
    call = _vision_calls()[-1]
    assert call.max_output_tokens == 8000
    assert call.extra_body == {"thinking": {"type": "disabled"}}


def test_stage_two_on_a_photo_does_not_inherit_stage_one_budget(staged_profiles):
    """Regression: 8000 tokens truncated the combined read-and-analyse call.

    The budget belongs to the stage, not to the endpoint it happens to use.
    """
    staged_profiles.post(
        "/api/v1/grade/photo", json=_photo(features={"reconstruct_first": False})
    )
    call = _vision_calls()[-1]
    assert call.max_output_tokens == 32000


def test_stage_two_on_a_photo_does_not_inherit_thinking_off(staged_profiles):
    """Stage 1 disables thinking; stage 2 is where finding the error happens."""
    staged_profiles.post(
        "/api/v1/grade/photo", json=_photo(features={"reconstruct_first": False})
    )
    assert _vision_calls()[-1].extra_body is None


def test_deep_think_still_wins_over_the_borrowed_profile(staged_profiles):
    staged_profiles.post(
        "/api/v1/grade/photo",
        json=_photo(features={"reconstruct_first": False, "deep_think_analysis": True}),
    )
    assert _vision_calls()[-1].extra_body == THINKING_ON


def test_registry_marks_the_flow_changing_toggle(client):
    """The UI needs to warn that this one is not just a paragraph."""
    rows = client.get("/api/v1/features").json()["features"]
    by_key = {r["key"]: r for r in rows}
    assert by_key["reconstruct_first"]["changes_flow"] is True
    assert all(
        r["changes_flow"] is False for k, r in by_key.items() if k != "reconstruct_first"
    ), "a toggle that moves a stage needs changes_flow=True and its own tests"


def test_public_listing_leaks_no_secrets(client):
    """It is reachable by every tester, so it must carry nothing sensitive."""
    body = client.get("/api/v1/features").text
    for smell in ("sk-", "api_key", "token", "password"):
        assert smell not in body.lower()
