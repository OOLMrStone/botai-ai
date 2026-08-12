"""JSON-schema helpers for structured output.

OpenAI's strict structured-output mode is pickier than plain JSON Schema:
every object must set `additionalProperties: false` and list *all* of its
properties in `required`; annotations like `default`/`title` are ignored at
best.  Pydantic does not emit that shape, so we post-process it here.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel

_STRIP_KEYS = ("default", "title", "examples", "$comment", "deprecated")
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def to_strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Pydantic model -> schema accepted by strict structured output."""
    return _harden(model.model_json_schema(ref_template="#/$defs/{model}"))


def _harden(node: Any) -> Any:
    if isinstance(node, list):
        return [_harden(item) for item in node]
    if not isinstance(node, dict):
        return node

    out: dict[str, Any] = {k: _harden(v) for k, v in node.items() if k not in _STRIP_KEYS}

    if out.get("type") == "object" or "properties" in out:
        # A `dict[str, X]` field emits an object with no `properties` and a
        # schema-valued `additionalProperties`. Strict mode cannot express that,
        # and silently closing it would produce a schema matching nothing at
        # all. Fail here instead of at 2am against a live provider.
        if isinstance(node.get("additionalProperties"), dict) and not node.get("properties"):
            raise ValueError(
                "strict structured output cannot represent an open mapping "
                "(dict[str, ...]); model the keys explicitly or use a list of "
                "key/value objects"
            )

        properties = out.get("properties") or {}
        out["properties"] = properties
        out["type"] = "object"
        out["additionalProperties"] = False
        # Strict mode has no notion of an optional key: everything is required,
        # and "absent" is expressed as a nullable type instead.
        out["required"] = list(properties.keys())

    return out


def schema_prompt_block(schema: dict[str, Any]) -> str:
    """Rendered schema for the prompt-only fallback mode."""
    return (
        "Ответ верни СТРОГО одним JSON-объектом без markdown-обёртки, "
        "без пояснений до или после, соответствующим схеме:\n"
        f"{json.dumps(schema, ensure_ascii=False, indent=2)}"
    )


def extract_json(text: str) -> str:
    """Pull a JSON object out of a model reply that may be wrapped in prose.

    Handles ```json fences and leading/trailing chatter.  Raises ValueError
    when nothing balanced can be found.
    """
    candidate = _FENCE.sub("", text.strip())

    try:
        json.loads(candidate)
    except ValueError:
        pass
    else:
        return candidate

    start = candidate.find("{")
    if start == -1:
        raise ValueError("no JSON object found in model output")

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(candidate)):
        char = candidate[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return candidate[start : index + 1]

    raise ValueError("unbalanced JSON object in model output")
