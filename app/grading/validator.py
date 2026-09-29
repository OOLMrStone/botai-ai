#!/usr/bin/env python3
"""Validate the task-16 draft response, without network calls or dependencies.

CLI: python scripts/validate_response.py response.json
parse_response(text) rejects malformed/extended JSON with ValueError.
validate_response(decoded_object) returns path-prefixed errors (empty = valid).
The caller must validate the exact final text before releasing it to a client;
this script alone cannot prevent a model from sending an unchecked response.
"""

import argparse
import json
from pathlib import Path
import re
import sys


from app.grading.package import task_directory

DEFAULT_CATALOG = task_directory() / 'popular_mistakes.md'


def load_error_codes(catalog_path=None) -> frozenset[str]:
    """Read declarations in the first table column, not references in prose."""
    path = DEFAULT_CATALOG if catalog_path is None else Path(catalog_path)
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"catalog: cannot read {path}: {exc}") from exc
    codes = re.findall(r"^[ \t]*\|[ \t]*(E[0-9]+)[ \t]*\|", content, re.MULTILINE)
    if not codes:
        raise ValueError(f"catalog: no error-code rows in {path}")
    if len(codes) != len(set(codes)):
        raise ValueError(f"catalog: duplicate error-code rows in {path}")
    return frozenset(codes)


CHECK = {"is_correct": bool, "reason": str}
SCHEMA = {
    "task": {
        "id": str,
        "task_number": int,
        "max_score": int,
        "statement": str,
        "reference_answer": str,
        "reference_solution": (str, type(None)),
    },
    "solution_image_ids": [str],
    "is_graded": bool,
    "rejection_reason": str,
    "ocr": (str, type(None)),
    "analysis": ({
        "summary": str,
        "checks": {
            "domain": (CHECK, type(None)),
            "transformations": (CHECK, type(None)),
            "completeness": {"is_complete": bool, "reason": str},
        },
        "student_answer": ({"text": str, "is_correct": bool}, type(None)),
        "errors": [{
            "id": str,
            "code": (str, type(None)),
            "description": str,
            "where": str,
            "correct_version": str,
            "advice": str,
        }],
        "strengths": [str],
    }, type(None)),
    "grading": ({
        "score": int,
        "criterion": str,
        "explanation": str,
    }, type(None)),
}


class _ObjectPairs(list):
    """Keep object members until duplicate keys can be checked with their path."""


def parse_response(text: str) -> object:
    """Parse the entire response, with exact object boundaries and no wrapper."""
    if not text.startswith("{") or not text.endswith("}"):
        raise ValueError("$: response must start with '{' and end with '}', with nothing outside")
    def reject_constant(value):
        raise ValueError(f"$: {value} is not a JSON number")

    try:
        raw = json.loads(text, object_pairs_hook=_ObjectPairs,
                         parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise ValueError(f"$: invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc

    def unpack(value, path):
        if isinstance(value, _ObjectPairs):
            result = {}
            for key, item in value:
                child = f"{path}.{key}"
                if key in result:
                    raise ValueError(f"{child}: duplicate key")
                result[key] = unpack(item, child)
            return result
        if isinstance(value, list):
            return [unpack(item, f"{path}[{index}]") for index, item in enumerate(value)]
        return value

    return unpack(raw, "$")


def validate_response(response: object, *, catalog_path=None) -> list[str]:
    """Return structural and supported consistency errors; never judge mathematics.

    For raw model output use parse_response first: duplicate keys cannot be
    recovered from an already decoded dictionary. IDs and task data are checked
    for type only; comparison with authoritative request data belongs to the caller.
    """
    errors = []

    def check(value, schema, path):
        if isinstance(schema, tuple):
            if value is None:
                return
            schema = schema[0]
        if isinstance(schema, dict):
            if type(value) is not dict:
                errors.append(f"{path}: expected object")
                return
            for key in schema:
                if key not in value:
                    errors.append(f"{path}.{key}: missing required field")
            for key in value:
                if key not in schema:
                    errors.append(f"{path}.{key}: unexpected field")
                else:
                    check(value[key], schema[key], f"{path}.{key}")
        elif isinstance(schema, list):
            if type(value) is not list:
                errors.append(f"{path}: expected array")
                return
            for index, item in enumerate(value):
                check(item, schema[0], f"{path}[{index}]")
        elif type(value) is not schema:
            name = {str: "string", int: "integer", bool: "boolean"}[schema]
            errors.append(f"{path}: expected {name}")

    check(response, SCHEMA, "$")
    if errors:
        return errors

    try:
        error_codes = load_error_codes(catalog_path)
    except ValueError as exc:
        return [str(exc)]

    task = response["task"]
    analysis = response["analysis"]
    grading = response["grading"]
    if task["task_number"] != 16:
        errors.append("$.task.task_number: expected 16 for this package")
    if task["max_score"] != 2:
        errors.append("$.task.max_score: expected 2 for this package")
    if not response["is_graded"]:
        if not response["rejection_reason"].strip():
            errors.append("$.rejection_reason: expected nonempty reason for rejection")
        for key in ("ocr", "analysis", "grading"):
            if response[key] is not None:
                errors.append(f"$.{key}: expected null for rejection")
        return errors
    if response["rejection_reason"] != "":
        errors.append("$.rejection_reason: expected empty string for graded response")
    for key in ("ocr", "analysis", "grading"):
        if response[key] is None:
            errors.append(f"$.{key}: required for graded response")
    if errors:
        return errors
    if grading["score"] not in (0, 1, 2):
        errors.append("$.grading.score: expected 0, 1 or 2")

    seen = set()
    for index, error in enumerate(analysis["errors"]):
        path = f"$.analysis.errors[{index}]"
        if error["id"] in seen:
            errors.append(f"{path}.id: duplicate error ID {error['id']!r}")
        seen.add(error["id"])
        if error["code"] is not None and error["code"] not in error_codes:
            errors.append(f"{path}.code: expected a code declared in popular_mistakes.md or null")

    return errors



class ValidationGate:
    """Per-request gate; the server must call finalize before releasing a result.

    validate returns errors, preserving only the exact successful raw text.
    finalize raises ValueError until the same text has passed validate.
    This instance must never be shared between grading requests.
    """

    def __init__(self, *, catalog_path=None):
        self._catalog_path = catalog_path
        self._validated_text = None

    def validate(self, candidate: str) -> list[str]:
        self._validated_text = None
        try:
            errors = validate_response(parse_response(candidate), catalog_path=self._catalog_path)
        except (ValueError, RecursionError) as exc:
            return [str(exc)]
        if not errors:
            self._validated_text = candidate
        return errors

    def finalize(self, candidate: str) -> object:
        if self._validated_text is None or candidate != self._validated_text:
            raise ValueError("$: final text must match the successfully validated candidate")
        errors = self.validate(candidate)
        if errors:
            raise ValueError("\n".join(errors))
        return parse_response(candidate)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("response", type=Path, help="UTF-8 file containing the exact final JSON")
    parser.add_argument("--catalog", type=Path, help="Trusted popular_mistakes.md snapshot")
    args = parser.parse_args(argv)
    try:
        response = parse_response(args.response.read_text(encoding="utf-8"))
        errors = validate_response(response, catalog_path=args.catalog)
    except (OSError, ValueError, RecursionError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    if errors:
        print("INVALID:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print("VALID")
    return 0


if __name__ == "__main__":
    sys.exit(main())
