# Internal prepared-task API

Implemented for private backend workers. The browser never receives the service
token or calls this endpoint. Enabling it does not enable additional math packages.

## Configuration and discovery

Set `INTERNAL_GRADING_ENABLED=true` and a nonempty `INTERNAL_GRADING_TOKEN` in the
server environment; recreate the process/container. Missing token fails startup.
The default is disabled; no internal routes are mounted. Keep `/internal/v1/*`
outside public ingress. Use TLS when backend and AI are on separate hosts.

Both endpoints require `Authorization: Bearer <token>` before body parsing.
`GET /internal/v1/grading/capabilities` reads local configuration only and never
calls a provider. It returns `contract_version`, `provider_mode` (`mock|live`),
`deadline_seconds`, `max_solution_images`, `max_image_bytes`, and seven `tasks`:

| Task | Max score | Supported |
| --- | --- | --- |
| 14 | 2 | false |
| 15 | 3 | false |
| 16 | 2 | true |
| 17 | 2 | false |
| 18 | 3 | false |
| 19 | 4 | false |
| 20 | 4 | false |

Each descriptor contains `task_number`, `max_score`, `package_id` (nullable),
`package_available`, `supported`, `response_contract`. Maxima belong to the FIPI
draft-2027 taxonomy. Unsupported entries have no handler or validator. Package
presence alone never enables support. An approved future handler belongs in the
AI registry; frontend/backend routing consumes capabilities rather than numbers.

## Request

`POST /internal/v1/grading`, with `X-Request-ID` equal to the backend run UUID.
Send multipart with one **text** part `metadata` and 1–4 file parts named
`solution_images`. File order must match `solution_image_ids`. Example metadata:

```json
{
  "contract_version": "photo-grade.v1",
  "task_version_id": "00000000-0000-4000-8000-000000000001",
  "task": {
    "id": "00000000-0000-4000-8000-000000000002",
    "task_number": 16,
    "max_score": 2,
    "statement": "Решите неравенство x > 2",
    "reference_answer": "(2; +∞)",
    "reference_solution": null
  },
  "solution_image_ids": ["00000000-0000-4000-8000-000000000003"]
}
```

IDs must be canonical UUID strings. No extra/duplicate keys or duplicate image
IDs. Statement/answer are nonempty, at most 16,000 characters each; reference
solution is null or nonempty, at most 32,000 characters. Metadata is at most
512 KiB; the streamed body is at most 33 MiB, even without Content-Length.
Photos are static JPEG/PNG/WebP, at most 8 MiB each, 20 MP and 8192 pixels per side.
AI repeats decode/re-encode validation. No URLs, PDF, SVG, paths, user identity,
cookies, overrides, database access or storage credentials are accepted as input.

## Response and acceptance

HTTP 200 returns the exact JSON accepted by the existing Session/validator;
see [response-format](../../tasks/common/prompts/response-format.md). It has no
transport envelope and no additional fields. Rejection is a validated 200 with
`is_graded=false`, a Russian reason and null OCR/analysis/grading. Failure is never
score zero. Task-image OCR is skipped; prompts and task-16 validator are unchanged.

Every run response, including errors, carries:

- `X-Request-ID`: canonical run UUID; a fresh safe UUID for invalid incoming IDs.
- `X-Grading-Contract-Version: photo-grade.v1`.
- `X-Grading-Provider-Mode: mock|live`, snapshotted for this run.
- `X-Grading-Package-Id: sha256:<digest>`, or `none` before selecting a supported package.
- `Cache-Control: no-store`.
- `X-Grading-Rejection-Code` when Session selects `other_task`, `multiple_tasks`,
  `unrelated`, `attack` or `unreadable`; also retained on handled subsequent failures.

Backend must validate schema, task/images and per-response mode/package against
the pinned capability. Cached capabilities cannot establish the mode of a later
run. Mock results are demonstrations and never award genuine progress. Save raw
JSON privately; expose only the safe product projection. The task object contains
reference answers and must not leak through a public result DTO.

Errors have `{error:{code,message,details:{}},request_id}`. Codes include
401 `service_unauthorized`; 422 `invalid_request_id`, `invalid_multipart`,
`invalid_task_snapshot`, `unsupported_contract`, `unsupported_task`,
`validation_error` (image decoding); 413 `upload_too_large`; 429 `grading_busy`;
502 `llm_error|llm_bad_response`; 504 `llm_timeout`; 503 `grading_package_changed`;
400 `upload_disconnected`; 500 safe internal/config error. Invalid routes and
methods return 404/405 without redirects. No provider body or request data is echoed.

AI shares the bounded photo concurrency limit and a maximum 360-second total
deadline. Backend has a bounded 390-second transport deadline, a 1 MiB response
limit, and disables redirects/retries. Run UUID provides correlation, not provider
idempotency. Uncertain dispatch outcomes require explicit retry with a new run.

Internal attack diagnostics log only run/image IDs. Backend already owns the
submission, user and photos; internal AI does not duplicate photographs in the
standalone ReportStore. The standalone endpoint remains compatible.

## Offline verification

`LLM_PROVIDER=mock LLM_VISION_PROVIDER=mock INTERNAL_GRADING_ENABLED=false .venv/bin/python -m pytest -k 'not test_ready_with_live_probe'`

Internal tests explicitly enable the route with a test token and prohibit paid
provider construction. The single legacy readiness-probe test is excluded;
no real environment values or approved prompts need to change for verification.
