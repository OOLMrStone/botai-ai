# Architecture

## The shape of a request

```
POST /api/v1/grade
      │
      ▼
api/routes_grading.py ──── FastAPI validation (GradeRequest)
      │
      ▼
grading/service.py
      │  resolve()      task 13–19 → TaskSpec, rubric, max_score
      │                 (criteria_override wins over the registry)
      │  build_messages()  ← grading/prompts.py
      │
      ▼
llm/client.py  complete_structured(schema=LLMVerdict)
      │  · asks for a strict JSON schema
      │  · retries transient failures with backoff
      │  · drops parameters the provider rejects, and remembers
      │  · falls back json_schema → json_object → schema-in-prompt
      │  · repairs malformed JSON once
      │  · records the whole thing in the trace ring buffer
      ▼
llm/providers/{openai_provider,mock}.py
      │
      ▼
grading/postprocess.py    clamp · snap to rubric · realign verdict
      │                    (+ median across samples when self-consistency > 1)
      ▼
GradeResponse
```

## Why the layers sit where they do

**`llm/` knows nothing about the ЕГЭ.** It takes messages and a Pydantic
schema and returns a validated instance. That is what makes it reusable for
the next feature (hint generation, solution rewriting, problem classification)
without dragging grading logic along.

**`domain/` knows nothing about the LLM.** `tasks.py` is a data registry and
`schemas.py` is wire types. Both are importable from a script, a notebook, or
a future admin UI with no model configured.

**`grading/` is the only place that knows both.** It is deliberately thin —
resolve the rubric, build a prompt, call the model, clamp the answer. When
grading gets smarter (retrieval over past work, per-criterion sub-calls,
image input), it grows here.

**`api/` is transport only.** No business logic in routes; they call
`GradingService` and return its result.

## Two-model split for verdicts

`LLMVerdict` is what the model is asked to produce. `GradeResponse` is what
the API returns. They are not the same type, and that is on purpose:

- Strict structured output ignores `minimum`/`maximum`/`multipleOf`. A
  constraint on `LLMVerdict` would not be enforced by the provider, and a
  Pydantic `ValidationError` on a value the model was never told about turns
  a recoverable situation into a 502.
- So `LLMVerdict` is constraint-free, and `postprocess.normalise()` enforces
  the bounds in Python — correcting and *reporting* rather than failing.

A model that returns `score: 9` on a 4-point task produces a clamped 4 and a
note in `meta.notes`, which is visible, greppable, and safe.

## Singletons and their lifetimes

`get_settings()`, `get_llm_client()`, `get_grading_service()` and
`get_recorder()` are process-wide, lazily built, and each has a `reset_*()`
used by tests and by `POST /debug/config/reload`.

The LLM client is a singleton **because it learns**: when a provider rejects
`temperature`, that lesson is stored on the client instance. A per-request
client would re-learn it — one wasted 400 per request instead of one per
process.

## Concurrency

Everything is `async`. `LLMClient` holds a semaphore sized by
`LLM_CONCURRENCY`, so `POST /grade/batch` (which fans out with
`asyncio.gather`) cannot open unbounded connections. Self-consistency sampling
(`GRADING_SELF_CONSISTENCY > 1`) fans out through the same semaphore.

A failing item in a batch is reported inline as `{ok: false, error: {...}}`;
it never fails the whole batch.

## Error handling

`core/errors.py` defines the taxonomy. Everything expected inherits
`ServiceError` and carries `status_code` + `code`:

| code | status | when |
|---|---|---|
| `validation_error`, `unknown_task` | 422 | bad request content |
| `debug_forbidden` | 403 | wrong `X-Debug-Token` |
| `debug_disabled` | 404 | toolkit off — deliberately not 403 |
| `llm_timeout` | 504 | model did not answer in time |
| `llm_rate_limited` | 429 | provider throttled us |
| `llm_bad_response` | 502 | model output never validated |
| `llm_misconfigured` | 500 | no API key, unknown provider |

Handlers in `main.py` render them into
`{"error": {"code", "message", "details"}, "request_id"}`. In `APP_ENV=prod`
unhandled exceptions are flattened to a generic message; elsewhere the real
text is returned to make development faster.

## Observability

A `X-Request-ID` (client-supplied or generated) is stored in a contextvar,
attached to every log record, echoed in the response header, and copied onto
every LLM trace. `APP_LOG_FORMAT=json` emits one JSON object per line with
that id, ready for any log shipper.

Token usage, latency, attempt count, structured-output mode and any
self-corrections come back in `meta` on every grading response — the caller
does not have to consult the logs to know what a grade cost.

## What is intentionally not here yet

No database, no queue, no auth, no caching, no rate limiting. This is the
basis; see [ROADMAP.md](ROADMAP.md) for the order those should arrive in and
where they plug in.
