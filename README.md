# ЕГЭ Math Part 2 — AI grading microservice

Grades развёрнутые решения of part 2 of the Russian ЕГЭ in profile
mathematics (задания 13–19) against the marking criteria, and returns a score
with per-error feedback in Russian.

Python 3.14 · FastAPI · OpenAI-compatible LLM · Docker Compose

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

→ <http://localhost:8000/docs>

Ships with `LLM_PROVIDER=mock`: the whole service works end to end with no API
key and no spend, returning synthetic-but-schema-valid grades. For real
grading set in `.env`:

```
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-5          # verify against your provider's catalogue
```

`LLM_BASE_URL` points the same provider at any OpenAI-compatible gateway.

### Without Docker

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python main.py          # or: uvicorn app.main:app --reload
.venv/bin/python -m pytest        # 81 tests, all offline, ~2s
```

## Grading a solution

```bash
curl -s -X POST localhost:8000/api/v1/grade \
  -H 'Content-Type: application/json' \
  -d '{
    "task_number": 13,
    "statement": "а) Решите уравнение 2sin²x + 3cos x = 0. б) Найдите корни на [−3π/2; 0].",
    "student_solution": "2(1−cos²x)+3cos x=0 ⇒ cos x=−1/2 ⇒ x=±2π/3+2πk. На отрезке: x=−2π/3."
  }'
```

```jsonc
{
  "score": 1,
  "max_score": 2,
  "verdict": "partially_correct",
  "criterion_matched": "Обоснованно получен верный ответ в пункте а) ИЛИ ...",
  "summary": "Уравнение решено верно, но при отборе корней потерян x = −4π/3.",
  "errors": [{"severity": "major", "where": "пункт б)", "description": "...", "how_to_fix": "..."}],
  "missing_justifications": ["..."],
  "answer_check": {"student_answer": "−2π/3", "expected_answer": "−4π/3; −2π/3", "matches": false},
  "confidence": 0.82,
  "meta": {"provider": "openai", "usage": {...}, "attempts": 1, "trace_ids": ["llm_..."]}
}
```

The published criteria for the problem at hand can be passed as
`criteria_override` and take precedence over the built-in registry — see
[docs/DOMAIN_EGE.md](docs/DOMAIN_EGE.md) for why that matters.

## API

| endpoint | |
|---|---|
| `POST /api/v1/grade` | grade one solution |
| `POST /api/v1/grade/batch` | grade up to `GRADING_BATCH_LIMIT` concurrently |
| `GET /api/v1/tasks` | задания 13–19 with rubrics and max scores |
| `GET /api/v1/tasks/{n}` | one task |
| `GET /health`, `/health/ready` | liveness / readiness (`?probe=true` calls the model) |
| `/debug/*` | debug toolkit — off by default |

## Debug toolkit

Off unless `DEBUG_ENABLED=true` *and* the request carries a matching
`X-Debug-Token`; force-disabled when `APP_ENV=prod`. Highlights:

```bash
# the exact prompt, without calling the model
curl -X POST localhost:8000/debug/grading/preview-prompt \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' -d '{...}'

# what we sent and what came back, with retries and token usage
curl localhost:8000/debug/llm/traces -H 'X-Debug-Token: local-dev-token'

# grade a built-in sample end to end
curl -X POST 'localhost:8000/debug/grading/sample?name=13_partial' \
  -H 'X-Debug-Token: local-dev-token'
```

Plus a deterministic offline provider you can script with exact replies and
simulated failures, and `debug.force_score` for instant free grades while
building a frontend. Full guide: [docs/DEBUG_TOOLKIT.md](docs/DEBUG_TOOLKIT.md).

## Documentation

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | working context, layout, invariants |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how a request flows, why the layers split that way |
| [docs/DOMAIN_EGE.md](docs/DOMAIN_EGE.md) | how part 2 is marked; rubric provenance |
| [docs/LLM_LAYER.md](docs/LLM_LAYER.md) | the model wrapper; adding a provider |
| [docs/DEBUG_TOOLKIT.md](docs/DEBUG_TOOLKIT.md) | testing without spend |
| [docs/ROADMAP.md](docs/ROADMAP.md) | what is next and why |

## Production

```bash
docker compose --profile prod up --build grading-api-prod   # :8001
```

Non-root, no reloader, no dev dependencies, JSON logs, debug toolkit hard-off,
`/docs` and `/openapi.json` disabled. Read
[docs/ROADMAP.md](docs/ROADMAP.md) before shipping — there is no auth, rate
limiting or persistence yet, and the built-in rubrics need reconciling against
the official ones.
