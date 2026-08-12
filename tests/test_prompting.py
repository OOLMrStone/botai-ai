"""The prompt library: loading, includes, substitution, and its safety property."""

from __future__ import annotations

import pytest

from app.prompting import PromptError, get_prompt_library
from app.prompting.loader import PromptLibrary

STAGES = ["stage1_reconstruction", "stage2_analysis", "stage3_grading"]


@pytest.fixture
def library() -> PromptLibrary:
    return get_prompt_library()


# -- loading ----------------------------------------------------------------
@pytest.mark.parametrize("name", STAGES)
def test_every_stage_loads(library, name):
    prompt = library.get(name)
    assert prompt.id == name
    assert prompt.version
    assert prompt.body


@pytest.mark.parametrize("number", [13, 14, 15, 16, 17, 18, 19])
def test_every_task_has_criteria_and_pitfalls(library, number):
    prompt = library.criteria(number)
    assert prompt.section("Критерии")
    assert prompt.section("Типичные потери баллов")
    assert prompt.meta["max_score"].isdigit()


def test_criteria_max_scores_match_the_registry(library):
    from app.domain.tasks import TASK_REGISTRY

    for number, spec in TASK_REGISTRY.items():
        assert int(library.criteria(number).meta["max_score"]) == spec.max_score


def test_criteria_carry_a_verified_flag(library):
    """Provisional rubrics must announce themselves — see docs/DOMAIN_EGE.md."""
    for number in range(13, 20):
        assert library.criteria(number).meta["verified"] in {"true", "false"}


def test_unknown_prompt_raises(library):
    with pytest.raises(PromptError, match="не найден"):
        library.get("no_such_prompt")


def test_names_lists_the_library(library):
    names = library.names()
    assert "stage1_reconstruction.md" in names
    assert "criteria/13.md" in names
    assert "README.md" not in names


# -- includes ---------------------------------------------------------------
def test_includes_are_inlined(library):
    body = library.get("stage1_reconstruction").body
    assert "Артефакт или ошибка ученика" in body  # from shared/_handwriting.md
    assert "Эквивалентные записи" in body  # from shared/_notation.md
    assert "{% include" not in body


def test_included_fragment_frontmatter_is_stripped(library):
    assert "id: _handwriting" not in library.get("stage1_reconstruction").body


def test_include_cannot_escape_the_prompts_directory(tmp_path):
    (tmp_path / "evil.md").write_text(
        "---\nid: evil\n---\n{% include ../../../etc/passwd %}", encoding="utf-8"
    )
    with pytest.raises(PromptError, match="вне каталога|не найден"):
        PromptLibrary(tmp_path).get("evil")


# -- rendering --------------------------------------------------------------
def test_render_substitutes(library):
    rendered = library.get("stage1_reconstruction").render(
        task_number=13, task_topic="Уравнение", statement="Решите уравнение..."
    )
    assert "Решите уравнение..." in rendered
    assert "{{" not in rendered


def test_missing_required_variable_is_reported(library):
    with pytest.raises(PromptError, match="statement"):
        library.get("stage1_reconstruction").render(task_number=13, task_topic="Уравнение")


def test_unpassed_placeholder_is_reported(tmp_path):
    (tmp_path / "t.md").write_text("---\nid: t\n---\nПривет, {{ nmae }}", encoding="utf-8")
    with pytest.raises(PromptError, match="nmae"):
        PromptLibrary(tmp_path).get("t").render()


def test_declared_required_vars_actually_appear_in_the_body(library):
    """A `required:` entry that is not used is a stale declaration."""
    for name in STAGES:
        prompt = library.get(name)
        assert set(prompt.required) <= prompt.placeholders, name


def test_student_text_containing_template_syntax_is_inert(tmp_path):
    """The safety property: a photographed prompt cannot reach the template engine."""
    (tmp_path / "t.md").write_text(
        "---\nid: t\nrequired: solution\n---\nРешение: {{ solution }}", encoding="utf-8"
    )
    (tmp_path / "secret.md").write_text("---\nid: secret\n---\nSECRET", encoding="utf-8")

    hostile = "{% include secret.md %} и {{ solution }}"
    rendered = PromptLibrary(tmp_path).get("t").render(solution=hostile)

    assert rendered == f"Решение: {hostile}"
    assert "SECRET" not in rendered


def test_malformed_frontmatter_is_rejected(tmp_path):
    (tmp_path / "t.md").write_text("нет frontmatter", encoding="utf-8")
    with pytest.raises(PromptError, match="frontmatter"):
        PromptLibrary(tmp_path).get("t")
