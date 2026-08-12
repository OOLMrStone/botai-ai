"""Run reports and cost accounting.

A report is written to be sent to someone outside the project, so the tests
that matter most are the ones about what must *not* be in it, and about not
presenting an estimate as a charge.
"""

from __future__ import annotations

import json

import pytest

from app.llm.pricing import DEFAULT_RATES, CostBreakdown, ModelRate, load_rates, price, total
from app.llm.types import Usage
from app.reporting import get_report_store, to_markdown
from tests.conftest import DEBUG_HEADERS


# --- pricing --------------------------------------------------------------
def test_provider_cost_beats_the_rate_table():
    """OpenRouter reports a real charge; nothing computed can improve on it."""
    usage = Usage(prompt_tokens=1000, completion_tokens=500, provider_cost_usd=0.0042)
    cost = price(usage, "deepseek-v4-flash")
    assert cost.usd == 0.0042
    assert cost.source == "provider"
    assert not cost.is_estimate


def test_table_cost_is_flagged_as_an_estimate():
    cost = price(Usage(prompt_tokens=1_000_000), "deepseek-v4-flash")
    assert cost.source == "table"
    assert cost.is_estimate
    assert cost.usd == pytest.approx(DEFAULT_RATES["deepseek-v4-flash"].input, rel=1e-6)


def test_cached_prompt_tokens_are_billed_at_the_cache_rate():
    """Cached tokens must be discounted, and not charged twice."""
    rates = {"m": ModelRate(input=10.0, cached_input=1.0, output=0.0)}
    full = price(Usage(prompt_tokens=1_000_000), "m", rates)
    cached = price(
        Usage(prompt_tokens=1_000_000, cached_prompt_tokens=1_000_000), "m", rates
    )
    assert full.usd == pytest.approx(10.0)
    assert cached.usd == pytest.approx(1.0)


def test_unknown_model_costs_unknown_not_zero():
    """A silent zero would understate a bill; unknown is the honest answer."""
    cost = price(Usage(prompt_tokens=1000), "some-model-nobody-priced")
    assert cost.usd is None
    assert cost.source == "unknown"


def test_free_tier_models_are_free():
    cost = price(Usage(prompt_tokens=5000), "nvidia/nemotron-nano-9b-v2:free")
    assert cost.usd == 0.0


def test_vendor_prefixed_model_matches_a_bare_table_entry():
    cost = price(Usage(prompt_tokens=1_000_000), "some-vendor/deepseek-v4-flash")
    assert cost.source == "table"


def test_total_is_partial_when_one_stage_is_unpriced():
    """Summing only the known stages would silently understate the run."""
    combined = total(
        [
            CostBreakdown(usd=0.001, source="table"),
            CostBreakdown(usd=None, source="unknown"),
        ]
    )
    assert combined.source == "partial"
    assert combined.detail["priced_calls"] == 1.0
    assert combined.detail["total_calls"] == 2.0


def test_pricing_override_replaces_the_default_rate():
    rates = load_rates({"deepseek-v4-flash": {"input": 999.0, "output": 0.0}})
    assert rates["deepseek-v4-flash"].input == 999.0


def test_malformed_pricing_entry_is_ignored_not_fatal():
    """A typo in LLM_PRICING must not take grading down."""
    rates = load_rates({"broken": "not-a-dict", "deepseek-v4-flash": {"input": 1.0}})
    assert rates["deepseek-v4-flash"].input == 1.0


# --- reports --------------------------------------------------------------
@pytest.fixture
def report(client):
    """One completed run, taken from the store the pipeline writes to."""
    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
        },
    )
    assert res.status_code == 200
    stored = get_report_store().get(res.json()["request_id"])
    assert stored is not None
    return stored


def test_report_captures_prompts_and_costs(report):
    assert report.ok
    assert report.stages
    for stage in report.stages:
        assert stage.prompt, "a report without the prompt cannot explain a bad grade"
        assert stage.prompt_chars == len(stage.prompt)
        assert stage.cost.usd is not None


def test_report_never_contains_the_api_key(report):
    """Reports are mailed to strangers. This is the test that matters."""
    blob = report.model_dump_json()
    assert "sk-" not in blob
    key = report.config["llm"]["api_key"]
    assert key is None or "..." in key or key == ""


def test_failed_run_is_still_reported(client):
    """The runs people complain about are the ones that broke."""
    before = {r.request_id for r in get_report_store().list()}
    client.post(
        "/api/v1/grade/photo",
        json={"task_number": 99, "statement": "нет такого", "solution_text": "x=1"},
    )
    new = [r for r in get_report_store().list() if r.request_id not in before]
    assert new, "a failed run produced no report"
    assert new[0].ok is False
    assert new[0].error


def test_markdown_render_is_readable(report):
    text = to_markdown(report)
    assert text.startswith("# Отчёт о проверке")
    assert "## Этапы" in text
    assert "sk-" not in text


def test_report_endpoints_require_the_debug_token(client, report):
    """Regression: these routes shipped once without the gate."""
    for path in ("/debug/reports", f"/debug/reports/{report.request_id}", "/debug/pricing"):
        assert client.get(path).status_code == 403, f"{path} is ungated"
        assert client.get(path, headers={"X-Debug-Token": "wrong"}).status_code == 403


def test_report_download_has_a_filename(client, report):
    res = client.get(
        f"/debug/reports/{report.request_id}",
        headers=DEBUG_HEADERS,
    )
    assert res.status_code == 200
    assert report.request_id in res.headers["content-disposition"]
    assert json.loads(res.text)["request_id"] == report.request_id


def test_missing_report_is_404_with_a_useful_message(client):
    res = client.get(
        "/debug/reports/grade_doesnotexist",
        headers=DEBUG_HEADERS,
    )
    assert res.status_code == 404
    assert "отчёт" in res.json()["error"]["message"]


def test_all_mock_run_is_not_labelled_an_estimate():
    """A mock run cost nothing; "(оценка)" would imply a rate table was used."""
    combined = total(
        [CostBreakdown(usd=0.0, source="mock"), CostBreakdown(usd=0.0, source="mock")]
    )
    assert combined.source == "mock"
    assert combined.usd == 0.0


def test_mixed_mock_and_real_is_still_an_estimate():
    """One real call means real money; the mock stages must not launder that."""
    combined = total(
        [CostBreakdown(usd=0.0, source="mock"), CostBreakdown(usd=0.004, source="table")]
    )
    assert combined.source == "table"
    assert combined.usd == pytest.approx(0.004)


def test_early_failures_get_distinct_request_ids(client):
    """Regression: reports for runs that failed before the id was minted all
    landed under "unknown" and overwrote each other in the store."""
    ids = []
    for task in (98, 99):
        res = client.post(
            "/api/v1/grade/photo",
            json={"task_number": task, "statement": "нет такого", "solution_text": "x=1"},
        )
        assert res.status_code == 422
        ids.append(res.json()["request_id"])

    stored = {r.request_id for r in get_report_store().list()}
    assert "unknown" not in stored
    failed = [r for r in get_report_store().list() if not r.ok]
    assert len({r.request_id for r in failed}) == len(failed), "ids collide"


# --- benchmark traceability ----------------------------------------------
def test_markdown_lists_every_flag_not_only_the_changed_ones(client):
    """Two runs are only comparable if both state the full flag set.

    A report that mentions only deviations reads identically to one from a
    build that had no toggles at all.
    """
    from app.features import BY_KEY

    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
            "features": {"solve_independently": False},
        },
    )
    report = get_report_store().get(res.json()["request_id"])
    text = to_markdown(report)

    assert "## Настройки прогона" in text
    for key in BY_KEY:
        assert f"`{key}`" in text, f"{key} missing from the report"
    # the deviation is marked, the rest are not
    assert "`solve_independently` **×**" in text
    assert "`exhaustive_findings` **×**" not in text


def test_markdown_records_prompt_versions(report):
    """A quality change has to be traceable to the prompt edit that caused it."""
    text = to_markdown(report)
    assert "Версии промптов" in text
    assert "stage2_analysis" in text


def test_report_features_are_complete_not_just_overrides(client):
    from app.features import BY_KEY

    res = client.post(
        "/api/v1/grade/photo",
        json={
            "task_number": 13,
            "statement": "Решите уравнение",
            "solution_text": "cos x = -1/2",
            "features": {"solve_independently": False},
        },
    )
    report = get_report_store().get(res.json()["request_id"])
    assert set(report.features) == set(BY_KEY)
    assert report.features_changed == {"solve_independently": False}


def test_default_run_still_records_the_full_flag_set(client):
    """The defaults case is the one most likely to be recorded as nothing."""
    from app.features import BY_KEY

    res = client.post(
        "/api/v1/grade/photo",
        json={"task_number": 13, "statement": "Решите", "solution_text": "cos x = -1/2"},
    )
    report = get_report_store().get(res.json()["request_id"])
    assert set(report.features) == set(BY_KEY)
    assert report.features_changed == {}
    assert "## Настройки прогона" in to_markdown(report)


def test_notes_are_not_duplicated(report):
    """A correction arrives twice — as a log event and in the response notes."""
    stripped = [n.removeprefix("постобработка: ").strip() for n in report.notes]
    assert len(stripped) == len(set(stripped)), f"duplicated notes: {report.notes}"


# --- tester feedback ------------------------------------------------------
def test_feedback_attaches_to_the_run(client, report):
    res = client.post(
        f"/api/v1/reports/{report.request_id}/feedback",
        json={"verdict": "wrong", "comment": "пункт б решён, балл не поставлен",
              "expected_base": 2, "expected_presentation": 1, "tester": "Вася"},
    )
    assert res.status_code == 200
    stored = get_report_store().get(report.request_id)
    assert stored.feedback.verdict == "wrong"
    assert stored.feedback.expected_base == 2
    assert stored.feedback.submitted_at


def test_feedback_needs_no_debug_token(client, report):
    """A tester's disagreement is the product of a test round; it must not sit
    behind a token they were never given."""
    res = client.post(
        f"/api/v1/reports/{report.request_id}/feedback", json={"verdict": "ok"}
    )
    assert res.status_code == 200


def test_feedback_on_a_missing_run_is_404(client):
    res = client.post("/api/v1/reports/grade_nope/feedback", json={"verdict": "ok"})
    assert res.status_code == 404


def test_feedback_shows_at_the_top_of_the_markdown(client, report):
    client.post(
        f"/api/v1/reports/{report.request_id}/feedback",
        json={"verdict": "wrong", "comment": "потерян корень", "tester": "Вася"},
    )
    text = to_markdown(get_report_store().get(report.request_id))
    assert "ОЦЕНКА НЕВЕРНА" in text
    assert "потерян корень" in text
    assert text.index("ОЦЕНКА НЕВЕРНА") < text.index("## Оценки")


# --- disk persistence -----------------------------------------------------
def test_reports_survive_a_restart_when_a_directory_is_configured(tmp_path):
    """Memory-only loses a whole test session on one restart."""
    from app.reporting import ReportStore, RunReport

    store = ReportStore(limit=2, directory=tmp_path)
    for n in range(4):
        store.add(RunReport(request_id=f"grade_{n}", created_at="2026-09-10T10:00:00+00:00"))

    fresh = ReportStore(limit=2, directory=tmp_path)      # simulates a restart
    assert fresh.get("grade_0") is not None, "evicted from memory and lost"
    assert len(fresh.list()) == 4, "listing must come from disk, not the ring"


def test_memory_only_store_still_works(tmp_path):
    from app.reporting import ReportStore, RunReport

    store = ReportStore(limit=2, directory=None)
    store.add(RunReport(request_id="a", created_at="2026-09-10T10:00:00+00:00"))
    assert store.get("a") is not None
    assert store.get("missing") is None


def test_persisted_report_keeps_feedback(tmp_path):
    from app.reporting import ReportStore, RunReport, TesterFeedback

    store = ReportStore(limit=5, directory=tmp_path)
    store.add(RunReport(request_id="grade_x", created_at="2026-09-10T10:00:00+00:00"))
    store.attach_feedback("grade_x", TesterFeedback(verdict="wrong", comment="нет"))

    fresh = ReportStore(limit=5, directory=tmp_path)
    assert fresh.get("grade_x").feedback.verdict == "wrong"
