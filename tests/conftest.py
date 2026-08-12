"""Test bootstrap.

The environment is set *before* any `app.*` import so pydantic-settings picks
it up, and so a developer's real `.env` cannot leak into a test run (process
env outranks the dotenv file).
"""

from __future__ import annotations

import os

os.environ.update(
    {
        "APP_ENV": "local",
        "APP_LOG_LEVEL": "WARNING",
        "APP_LOG_FORMAT": "console",
        "LLM_PROVIDER": "mock",
        "LLM_MODEL": "mock-model",
        "LLM_API_KEY": "",
        "LLM_MAX_RETRIES": "2",
        "LLM_STRUCTURED_MODE": "auto",
        "GRADING_SELF_CONSISTENCY": "1",
        "DEBUG_ENABLED": "true",
        "DEBUG_TOKEN": "test-token",
        "DEBUG_RECORD_TRACES": "true",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings, reset_settings_cache  # noqa: E402
from app.grading import reset_grading_service  # noqa: E402
from app.grading.pipeline import reset_pipeline  # noqa: E402
from app.llm import get_llm_client, reset_llm_client  # noqa: E402
from app.llm.recorder import reset_recorder  # noqa: E402

DEBUG_HEADERS = {"X-Debug-Token": "test-token"}


@pytest.fixture(autouse=True)
def _clean_singletons():
    """Every test gets fresh settings, clients, services and recorder.

    The photo pipeline is in here for the same reason as the rest: it caches
    the LLM clients it was built with, so without a reset it keeps calling
    through a client bound to a *previous* test's recorder — and a trace
    assertion then looks up an id the current recorder has never seen.
    """
    reset_settings_cache()
    reset_llm_client()
    reset_grading_service()
    reset_pipeline()
    reset_recorder()
    yield
    reset_settings_cache()
    reset_llm_client()
    reset_grading_service()
    reset_pipeline()
    reset_recorder()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def client():
    from app.main import create_app

    with TestClient(create_app(get_settings())) as test_client:
        yield test_client


@pytest.fixture
def mock_provider():
    """The MockProvider backing the process-wide client."""
    return get_llm_client().provider


@pytest.fixture
def grade_payload():
    return {
        "task_number": 13,
        "statement": "а) Решите уравнение 2sin²x + 3cos x = 0. б) Отберите корни на [−3π/2; 0].",
        "student_solution": "cos x = −1/2, x = ±2π/3 + 2πk. На отрезке: x = −2π/3.",
    }
