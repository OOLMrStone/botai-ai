# Bot AI — standalone photo grading

A FastAPI microservice for checking photographed ЕГЭ mathematics solutions. The current workflow supports project tasks 14–20 (ФИПИ-2026 tasks 13–19), with one task-specific score and feedback in Russian. Integration with the main application's users, tasks and database is outside this implementation.

Python 3.14 · FastAPI · OpenAI-compatible model · Docker Compose

## Three local testing sites from one clone

Student, expert and AI developer interfaces, backend and evals are included in
[`Testing/`](Testing/README.md). Give a fresh agent
[`Testing/App/prompt.md`](Testing/App/prompt.md), or run
`python3 Testing/App/run.py up` from this repository. The first launch uses mock
AI and requires no provider key; the guide explains real-model testing.

## Current development state — 21 October 2026

`main` is the integrated service and portable application: the staged flow and
approved prompt packages for project tasks 14–20, local v2 contract/validation
fixes, and the native local launcher. See [architecture](docs/ARCHITECTURE.md),
[photo workflow](docs/grading/service.md), and [local launch](docs/LOCAL_APP.md).
The repository version is not a claim that production has been redeployed.

Only two named branches are allowed: `main` (verified integration) and `develop`
(work not yet integrated). Do not create feature or agent branches. Use a detached
checkout for isolated validation when needed, then integrate verified changes into
`main`. Historical branch tips are retained under `archive/2026-10-21/` tags.

## Portable local app

The [local app](docs/LOCAL_APP.md) runs the same staged checking service on the
computer and calls DeepSeek directly. Native Windows/macOS builds need no Python
on the tester's machine. Editable shared and task-specific prompts live beside
the executable; all task packages 14–20, including optional OCR instructions,
are included. Start from source without charges:
`.venv/bin/python scripts/run_local.py --mock`.

## Run locally without model charges

```bash
cp .env.example .env
LLM_PROVIDER=mock LLM_VISION_PROVIDER=mock docker compose up --build
```

Open [the test form](http://localhost:8000/ui/). Mock mode returns a clearly labelled demonstration: it does not recognize or grade the uploaded work.

1. Attach one image containing the problem statement and reference solution or correct answer.
2. Attach one to four images of the student's work, in order.
3. Submit and inspect the recognized text, analysis and single score, or the reason grading was declined.

Each image may be up to 8 MiB. A complete request may contain all five images. Preparation and grading share a 360-second deadline; retries are manual. A readable statement and correct answer are required. A missing complete reference solution is allowed and shown in the form.

## How the new workflow works

A separate session reads the task image. The student's photographs are read
without the reference answer, then structured and analysed; a separate grading
call applies the selected criteria. The server validates the final JSON and
returns the exact checked text. See the current [workflow](docs/grading/service.md).

The result contains `task`, `solution_image_ids`, `is_graded`, `rejection_reason`, `ocr`, `analysis` and `grading`. A declined submission has no score: its three result fields are `null`. Technical failures are errors, never zero grades. Structural validation does not establish mathematical correctness.

The test service creates local test IDs. It does not claim they are records in the main application's database. Suspected attacks produce private reports linked to these IDs; reports and associated solution images expire after 30 days. There is no report dashboard or automatic blocking.

## Configuration and real-model testing

Both task preparation and the new grading conversation use `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. The old `LLM_VISION_*` overrides belong to the legacy pipeline and do not select the model for `/api/v1/photo-check`.

Keep real credentials in the environment or a private `.env`; never commit them. After changing environment settings, recreate the container:

```bash
docker compose up -d --force-recreate
```

A restart alone preserves the previous container environment. Do not switch models silently: check the configured provider's image and tool support and alias policy. DeepSeek publishes model and alias changes in its [official updates](https://api-docs.deepseek.com/updates/).

Paid model calls require a direct user request in the current message. Offline tests and mock runs verify service behavior; saved evals document the already completed model runs.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/photo-check` | Multipart upload: one `task_image`, one to four repeated `solution_images`, optional `task_number`14–20 (default16) |
| `GET /api/v1/photo-check/config` | Form configuration and local test identity; no model call |
| `GET /ui/` | Standalone test form |
| `GET /health` | Application liveness when called directly on the application |
| `GET /health/ready` | Legacy readiness; do not use `?probe=true` without authorization because it calls a model |

The existing text and legacy photo endpoints remain for compatibility; their contracts are different from the new standalone workflow. See the local [API documentation](http://localhost:8000/docs) when enabled.

## Offline verification

```bash
.venv/bin/python -m pytest
.venv/bin/python scripts/validate_response.py response.json
```

Install development dependencies from `requirements-dev.txt` in a Python 3.14 virtual environment if needed. The tests run offline. The standalone validator shares its implementation with the service; server sessions additionally check the task and image IDs against the request.

## Documentation

- [Working instructions](AGENTS.md)
- [Current written contract](docs/grading/service.md)
- [Local B2B v2 boundary and offline evidence](docs/grading/internal-v2-proposal.md)
- [Prompt package and validator](tasks/16/README.md)
- [Deployment and access](docs/DEPLOYMENT.md)
- [Isolated server DEVELOP, model gateway and security snapshots](docs/DEVELOPMENT_SERVER.md)
- [Legacy architecture](docs/ARCHITECTURE.md) and [debug toolkit](docs/DEBUG_TOOLKIT.md)

The test service was deployed on 27 September 2026. Existing eval results and their limits are documented in [task 16](tasks/16/README.md). Deployment and current migration verification are tracked in [DEPLOYMENT.md](docs/DEPLOYMENT.md); a historical deployment test does not certify later edits.
