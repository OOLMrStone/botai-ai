"""Offline checks for the standalone draft contract and final-response gate."""

import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/validate_response.py"
spec = importlib.util.spec_from_file_location("grading_validator", SCRIPT)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


@pytest.fixture
def response():
    return {
        "task": {"id": "task-1", "task_number": 16, "max_score": 2,
                 "statement": "x > 0", "reference_answer": "(0; +∞)",
                 "reference_solution": None},
        "solution_image_ids": ["image-1", "image-2"],
        "is_graded": True, "rejection_reason": "",
        "ocr": "x > 0\nОтвет: (0; +∞)",
        "analysis": {
            "summary": "Решение верно", "checks": {
                "domain": None, "transformations": {"is_correct": True, "reason": "Верно"},
                "completeness": {"is_complete": True, "reason": "Полное решение"}},
            "student_answer": {"text": "(0; +∞)", "is_correct": True},
            "errors": [], "strengths": ["Верный ответ"]},
        "grading": {"score": 2, "criterion": "Верное решение",
                    "explanation": "Решение верно"},
    }


def error(error_id="a", code=None):
    return {"id": error_id, "code": code, "description": "Ошибка",
            "where": "2 + 2 = 5", "correct_version": "2 + 2 = 4", "advice": "Перепроверь"}


def test_valid_variants_and_array_lengths(response):
    assert validator.validate_response(response) == []
    response["analysis"]["errors"] = [error(), error("b", None)]
    response["analysis"]["strengths"] = []
    response["solution_image_ids"] = []
    response["analysis"]["student_answer"] = None
    response["analysis"]["checks"]["transformations"] = None
    assert validator.validate_response(response) == []


def object_paths(value, path=()):
    if isinstance(value, dict):
        yield path, value
        for key, item in value.items():
            yield from object_paths(item, path + (key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from object_paths(item, path + (index,))


def get(value, path):
    for key in path:
        value = value[key]
    return value


def test_required_and_extra_fields_at_every_level(response):
    response["analysis"]["checks"]["domain"] = {"is_correct": True, "reason": "Верно"}
    response["analysis"]["errors"] = [error()]
    for path, obj in object_paths(response):
        for key in obj:
            candidate = copy.deepcopy(response)
            del get(candidate, path)[key]
            assert any("missing required" in e for e in validator.validate_response(candidate))
        candidate = copy.deepcopy(response)
        get(candidate, path)["extra"] = 1
        assert any("unexpected field" in e for e in validator.validate_response(candidate))


@pytest.mark.parametrize("path,value", [
    (("task", "task_number"), True), (("task", "max_score"), True),
    (("grading", "score"), False), (("grading", "score"), 1.0),
    (("is_graded",), 1), (("ocr",), None),
    (("solution_image_ids",), "image-1"), (("solution_image_ids",), [1]),
    (("analysis", "strengths"), [None]), (("analysis", "errors"), ["E01"]),
    (("analysis", "checks", "completeness"), None),
    (("analysis", "checks", "transformations", "is_correct"), "true"),
    (("analysis", "student_answer", "is_correct"), None),
    (("task", "max_score"), 3), (("grading", "score"), -1),
    (("grading", "score"), 3), (("grading", "criterion"), None),
    (("analysis", "checks"), None),
])
def test_reject_bad_fields(response, path, value):
    get(response, path[:-1])[path[-1]] = value
    errors = validator.validate_response(response)
    assert errors and any("$." + ".".join(path) in e for e in errors)


@pytest.mark.parametrize("code", ["E00", "E100", "E1", "e01", "", 1])
def test_reject_unknown_codes(response, code, tmp_path):
    catalog = tmp_path / "popular_mistakes.md"
    catalog.write_text("| E01 | Ошибка | Совет |\n", encoding="utf-8")
    response["analysis"]["errors"] = [error(code=code)]
    assert validator.validate_response(response, catalog_path=catalog)


def test_codes_match_current_reference():
    reference = validator.DEFAULT_CATALOG
    assert validator.load_error_codes() == set(re.findall(r"^\| (E\d+) \|", reference.read_text(), re.M))


def test_unique_error_ids_not_unique_codes(response):
    response["analysis"]["errors"] = [error(), error("b")]
    assert validator.validate_response(response) == []
    response["analysis"]["errors"][1]["id"] = "a"
    assert any("duplicate error ID" in e for e in validator.validate_response(response))


def test_rejection_constraints(response):
    response.update(is_graded=False, rejection_reason="Решение другого задания",
                    ocr=None, analysis=None, grading=None)
    assert validator.validate_response(response) == []
    for key, value in [("rejection_reason", ""), ("rejection_reason", "  "),
                       ("ocr", "text"), ("is_graded", True)]:
        candidate = copy.deepcopy(response)
        candidate[key] = value
        assert validator.validate_response(candidate)


def test_old_contract_and_nonempty_success_reason_rejected(response):
    response["grading"]["is_target_task"] = True
    assert validator.validate_response(response)
    del response["grading"]["is_target_task"]
    response["rejection_reason"] = "reason"
    assert validator.validate_response(response)


@pytest.mark.parametrize("key", ["ocr", "analysis", "grading"])
def test_graded_requires_each_result_and_rejection_forbids_each(response, key):
    candidate = copy.deepcopy(response)
    candidate[key] = None
    assert any(f"$.{key}: required" in e for e in validator.validate_response(candidate))
    candidate.update(is_graded=False, rejection_reason="Работа нечитаема",
                     ocr=None, analysis=None, grading=None)
    candidate[key] = response[key]
    assert any(f"$.{key}: expected null" in e for e in validator.validate_response(candidate))


@pytest.mark.parametrize("relative", [
    "tests/fixtures/grading/response-not-graded.example.json",
    "tests/fixtures/grading/eval-15.3.3.report.json",
])
def test_shipped_complete_examples_match_current_contract(relative):
    raw = (ROOT / relative).read_text(encoding="utf-8")
    gate = validator.ValidationGate()
    assert gate.validate(raw) == []
    assert gate.finalize(raw) == json.loads(raw)


def test_rejection_gate_preserves_exact_raw_text(response):
    response.update(is_graded=False, rejection_reason="Работа нечитаема",
                    ocr=None, analysis=None, grading=None)
    raw = json.dumps(response, ensure_ascii=False)
    gate = validator.ValidationGate()
    assert gate.validate(raw) == []
    assert gate.finalize(raw) == response
    with pytest.raises(ValueError):
        gate.finalize(json.dumps(response))


@pytest.mark.parametrize("raw", [
    '{"a":1,"a":2}', '{"a":{"b":1,"b":2}}', '{"a":NaN}',
    '{"a":Infinity}', '{"a":-Infinity}', '```json\n{}\n```', '{} trailing',
    '{} {}', '{"a":1,}', '', ' {}', '{}\n', '\n{}', '{} ',
    'Here is the result: {}', '{} Done',
])
def test_reject_invalid_json(raw):
    with pytest.raises(ValueError):
        validator.parse_response(raw)


@pytest.mark.parametrize("value", [None, [], 1, "text", True])
def test_reject_non_object_root(value):
    assert validator.validate_response(value) == ["$: expected object"]


def test_cli(response, tmp_path):
    path = tmp_path / "response.json"
    path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout.strip() == "VALID"
    response["grading"]["score"] = True
    path.write_text(json.dumps(response), encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
    assert result.returncode != 0 and "$.grading.score" in result.stderr
    path.unlink()
    result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
    assert result.returncode != 0 and "INVALID" in result.stderr


def test_gate_requires_exact_successful_validation(response):
    raw = json.dumps(response)
    gate = validator.ValidationGate()
    with pytest.raises(ValueError):
        gate.finalize(raw)
    assert gate.validate(raw) == []
    with pytest.raises(ValueError):
        gate.finalize(raw + "\n")
    assert gate.finalize(raw) == response
    assert gate.validate("not JSON")
    with pytest.raises(ValueError):
        gate.finalize(raw)
    assert gate.validate(raw) == []
    invalid = copy.deepcopy(response)
    invalid["grading"]["score"] = 99
    assert gate.validate(json.dumps(invalid))
    with pytest.raises(ValueError):
        gate.finalize(raw)


def test_catalog_add_remove_and_prose_references(response, tmp_path):
    catalog = tmp_path / "popular_mistakes.md"
    catalog.write_text("| E01 | Ошибка | Совет |\nУпоминание E100 не объявляет ошибку.\n"
                       "| Ситуация | См. E101 |\n", encoding="utf-8")
    response["analysis"]["errors"] = [error(code="E100")]
    assert validator.load_error_codes(catalog) == {"E01"}
    assert validator.validate_response(response, catalog_path=catalog)
    catalog.write_text("| E01 | Ошибка | Совет |\n| E100 | Новая ошибка | Совет |\n",
                       encoding="utf-8")
    assert validator.validate_response(response, catalog_path=catalog) == []
    catalog.write_text("| E01 | Ошибка | Совет |\n", encoding="utf-8")
    assert validator.validate_response(response, catalog_path=catalog)


def test_null_code_is_valid_but_field_required(response, tmp_path):
    catalog = tmp_path / "popular_mistakes.md"
    catalog.write_text("| E100 | Ошибка | Совет |\n", encoding="utf-8")
    response["analysis"]["errors"] = [error(code=None)]
    response["analysis"]["errors"][0]["advice"] = ""
    assert validator.validate_response(response, catalog_path=catalog) == []
    del response["analysis"]["errors"][0]["code"]
    errors = validator.validate_response(response, catalog_path=catalog)
    assert any("$.analysis.errors[0].code" in e and "missing required" in e for e in errors)


def test_empty_lists_are_valid_for_target_task(response):
    response["solution_image_ids"] = []
    response["analysis"]["errors"] = []
    response["analysis"]["strengths"] = []
    assert response["is_graded"] is True
    assert validator.validate_response(response) == []


@pytest.mark.parametrize("contents", [None, "", "См. E100, без таблицы",
                                      "| E100 | Ошибка |\n| E100 | Дубликат |\n"])
def test_catalog_failure_is_not_silently_accepted(response, tmp_path, contents):
    catalog = tmp_path / "popular_mistakes.md"
    if contents is not None:
        catalog.write_text(contents, encoding="utf-8")
    assert validator.validate_response(response, catalog_path=catalog)
    gate = validator.ValidationGate(catalog_path=catalog)
    raw = json.dumps(response)
    assert gate.validate(raw)
    with pytest.raises(ValueError):
        gate.finalize(raw)


def test_gate_rechecks_catalog_and_clears_success(response, tmp_path):
    catalog = tmp_path / "popular_mistakes.md"
    catalog.write_text("| E100 | Ошибка | Совет |\n", encoding="utf-8")
    response["analysis"]["errors"] = [error(code="E100")]
    raw = json.dumps(response)
    gate = validator.ValidationGate(catalog_path=catalog)
    assert gate.validate(raw) == []
    assert gate.finalize(raw) == response
    catalog.write_text("| E01 | Другая ошибка | Совет |\n", encoding="utf-8")
    with pytest.raises(ValueError):
        gate.finalize(raw)
    catalog.write_text("| E100 | Ошибка | Совет |\n", encoding="utf-8")
    with pytest.raises(ValueError):
        gate.finalize(raw)
    assert gate.validate(raw) == []
    catalog.unlink()
    assert gate.validate(raw)
    catalog.write_text("| E100 | Ошибка | Совет |\n", encoding="utf-8")
    with pytest.raises(ValueError):
        gate.finalize(raw)


def test_cli_catalog_and_default_from_other_directory(response, tmp_path):
    response_path = tmp_path / "response.json"
    response_path.write_text(json.dumps(response), encoding="utf-8")
    default = subprocess.run([sys.executable, str(SCRIPT), response_path.name], cwd=tmp_path,
                             capture_output=True, text=True)
    assert default.returncode == 0 and default.stdout.strip() == "VALID"
    response["analysis"]["errors"] = [error(code="E100")]
    response_path.write_text(json.dumps(response), encoding="utf-8")
    catalog = tmp_path / "catalog.md"
    catalog.write_text("| E100 | Новая ошибка | Совет |\n", encoding="utf-8")
    command = [sys.executable, str(SCRIPT), response_path.name, "--catalog", catalog.name]
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout.strip() == "VALID"
    catalog.unlink()
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode != 0 and "INVALID" in result.stderr
