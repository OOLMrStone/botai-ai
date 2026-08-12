# Debug toolkit

Test-and-inspect hooks built into the service so grading can be exercised
without spending money, without a model, and without guessing what was sent.

## Switching it on

```bash
DEBUG_ENABLED=true
DEBUG_TOKEN=local-dev-token     # any non-empty value; required
```

Both are already set in `.env.example`, so `docker compose up` gives you a
working toolkit out of the box.

Every `/debug` route needs the header:

```bash
curl -H 'X-Debug-Token: local-dev-token' localhost:8000/debug/ping
```

### The safety interlocks

Four of them, because this surface dumps prompts and forges scores:

1. `DEBUG_ENABLED=false` (the default in code) → the router is **not mounted**.
   The routes do not exist and do not appear in the OpenAPI schema.
2. A missing or wrong `X-Debug-Token` → 403. Compared with
   `hmac.compare_digest`.
3. `DEBUG_ENABLED=true` with an empty `DEBUG_TOKEN` → toolkit disables itself
   and logs an error. No accidental open surface.
4. `APP_ENV=prod` → toolkit force-disabled with a loud log line, unless
   `DEBUG_ALLOW_IN_PROD=true` is *also* set. The prod compose profile hardcodes
   `DEBUG_ENABLED=false`.

When disabled, `/debug/*` returns **404, not 403** — a probe should not learn
that the surface exists. `request.debug` on a grading call is dropped before it
reaches the service, so inline levers go dead at the same time.

`GET /health` always reports the current state as `debug_tools: true|false`.

---

## The offline provider

`LLM_PROVIDER=mock` runs the entire service with no API key, no network, no
spend — the default in `.env.example`, and what the whole test suite uses.

It is deterministic: a given prompt always produces the same reply, seeded by a
hash of the prompt, so assertions are stable across runs. When a JSON schema is
requested it synthesises a **schema-valid** instance — including on the lower
rungs of the structured-output ladder, where it recovers the schema from the
prompt. Field names steer the values (`*score*` → a small int, `confidence` →
0.55–0.95, `summary`/`description` → a Russian sentence).

Startup logs `LLM_PROVIDER=mock — grades are synthetic, no model is being
called`, so mock output is never mistaken for a real grade.

### Pinning a score from inside the prompt

Put `[[MOCK_SCORE=n]]` anywhere in the prompt and the synthesised verdict
scores exactly `n`:

```bash
curl -s -X POST localhost:8000/debug/llm/echo \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"[[MOCK_SCORE=2]]"}],"as_verdict":true}'
```

### Scripting exact replies and failures

Queued FIFO, one per model call — the way to drive retry and fallback paths:

```bash
# next call returns this exact text
curl -X POST localhost:8000/debug/llm/mock/script \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' \
  -d '{"text":"не json"}'

# next call fails: timeout | rate_limit | bad_response | generic
curl -X POST localhost:8000/debug/llm/mock/script \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' \
  -d '{"error":"rate_limit"}'

# simulate a slow model (ms) — for timeout and concurrency work
curl -X POST localhost:8000/debug/llm/mock/latency \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' \
  -d '{"latency_ms":3000}'

curl    localhost:8000/debug/llm/mock -H 'X-Debug-Token: local-dev-token'  # state
curl -X DELETE localhost:8000/debug/llm/mock -H 'X-Debug-Token: local-dev-token'
```

Script a `rate_limit` then grade: the response comes back fine with
`meta.attempts: 2` and a `transient …, retry 1 in 0.6s` note. That is the
retry path proven end to end over HTTP.

---

## The browser console — watching a grade happen

`http://localhost:8000/` is a single page with no build step. It posts to
`POST /api/v1/grade/photo/stream` and renders the run as it happens:

- **a progress bar and one tile per stage**, each showing the model actually
  used and, on completion, its latency and token count;
- **a live console**, timestamped and deliberately short: the flag state, each
  stage's model output, warnings (retries, ladder downgrades, post-processing
  corrections) and the verdict. Prompts are *not* logged — they are identical
  every run and buried the one line that differs; they stay in the report;
- **«Скопировать лог» / «Лог (.txt)»** — the *exported* log, which is not the
  same as what is on screen.

This exists because grading is three sequential calls and can run for minutes.
A plain request gives no way to tell "still thinking" from "hung" — and with
free models, minutes-long stages are normal, not a fault.

The stream sends a `: keepalive` comment every 15 seconds. Without it a proxy
sitting between the browser and uvicorn will close a connection that has been
silent while a model generates.

`stage_done` frames always carry progress, timing, tokens and cost — a caller
is entitled to know how long its own request took and what it spent.

The rendered prompt and the parsed output ride along **only while the debug
toolkit is on**. Those are the prompt library in full and, through it, the
student's work; streaming them to every client would put the toolkit's most
sensitive output on an ungated endpoint. With the toolkit off the page still
draws its progress bar and simply notes that call detail is hidden. Neither is
truncated when present — truncating the thing you are trying to read would
defeat the purpose.

**Errors arrive as an `error` event, not an HTTP status.** By the time a stage
fails, `200 OK` and the headers have already been sent. The page turns the
remaining tiles red and prints the code; anything else would look like a hang.

`POST /api/v1/grade/photo/upload` remains the plain non-streaming endpoint, and
the final `result` frame is byte-for-byte what it would have returned.

### The exported log

The console stays short deliberately. The exported log does not: someone
reading it a week later, with no access to that machine, has to be able to say
what was tested, under which settings, and what came out. It carries, above
the log lines themselves:

* request id, timestamp, task, statement, and whether the input was a photo;
* **every feature flag with its value**, deviations marked `×` — not only the
  changed ones. A log that lists only deviations reads identically to one from
  a build that had no toggles at all, which makes two runs incomparable;
* prompt versions, so a quality change traces to the edit that caused it;
* per-stage model, latency, tokens and cost, plus the totals;
* both grades, points at risk, confidence, the findings and the advice.

That makes one file enough to compare two benchmark runs. The same information
is in the JSON and markdown reports; this is the readable arrangement of it.

## Run reports — the file a tester sends back

Every run is recorded as a single self-contained file. A tester who hits a bad
grade sends you that file, and it answers, without them present:

* what was sent — the photo, the statement, every rendered prompt;
* what came back — raw model text, parsed objects, both grades;
* what it cost, how long each stage took, how many attempts it needed;
* which models, prompt versions and settings produced it.

Because only stage 1 sees the photograph, a wrong grade is usually a wrong
*reading*. The report puts the transcript next to the grade so that is the
first thing you check.

**Getting one.** After a run the page enables **«Скачать отчёт (.json)»** —
the report arrives as the last event of the stream, so saving it needs no
extra request. **«Отчёт (.md)»** fetches the readable rendering and will ask
once for the debug token.

```bash
curl localhost:8000/debug/reports -H 'X-Debug-Token: local-dev-token'
curl 'localhost:8000/debug/reports/grade_b4cf00...?fmt=md' -H 'X-Debug-Token: ...'
```

`fmt=json` is the artefact; `fmt=md` is for skimming or pasting into an issue.
The last 20 runs are kept, in memory only — same trade-off as the traces.
Reports contain student work, so a service with no retention policy should not
be hoarding them.

**Failed runs are reported too**, with whatever stages completed and the error
that stopped it. Those are the ones people actually complain about.

**Secrets never enter a report.** Config comes from `Settings.redacted()`,
which masks the API key and debug token, and a test asserts no `sk-` string
survives anywhere in the file. These files are designed to be forwarded, so
this is the one place where "we'll add masking later" would be a leak.

## Money

Every stage carries a cost, and the page shows a running total beside the
clock.

```
✔ reconstruction   8.8s   5696 tok (кэш 1536, размышл. 0)     $0.001334 [table]
✔ analysis        58.2s  11613 tok (кэш 896,  размышл. 7339)  $0.004142 [table]
✔ grading         28.5s   6834 tok (кэш 896,  размышл. 3421)  $0.002279 [table]
                                                       итого  $0.007755
```

**`source` is not decoration.** `provider` means the provider reported that
charge; `table` means it was computed from a rate table someone typed in and
is an *estimate*; `partial` means at least one stage could not be priced and
the total is a floor, not a figure; `unknown` means exactly that. A model
missing from the table costs `null`, never `0` — a silent zero would
understate a bill.

The built-in rates in `llm/pricing.py` are **unverified list prices** and go
stale. Check them against your provider's pricing page, and override without
touching code:

```bash
LLM_PRICING={"deepseek-v4-flash":{"input":0.28,"cached_input":0.028,"output":0.42}}
```

Units are USD per million tokens, so a rate can be copied off a pricing page
with no arithmetic. `GET /debug/pricing` shows the table in force.

Two counters are broken out because they drive the bill and the clock:
`cached_prompt_tokens` (billed at a fraction of the input rate — our prompts
share a long fixed preamble, so on a repeat run this is most of the prompt)
and `reasoning_tokens` (billed as output; on stage 1 this should read 0, and
if it does not, `LLM_VISION_EXTRA_BODY` is not reaching the provider).

## The request console — `/ui/console.html`

A second page, linked from the first. Where the main page is the tester's
form, this one is the raw wire: **any method, any path, any JSON body**, with
the response shown verbatim — status, latency, size, `X-Request-ID`, and a
download button.

What it is for:

- **driving the gated endpoints from a browser.** Paste the `DEBUG_TOKEN`
  once; it goes out as `X-Debug-Token` on every request and is kept in that
  browser's `localStorage`, nowhere else. «проверить» pings `/debug/ping` and
  tells you which of the three states you are in: accepted, wrong token (403),
  or `DEBUG_ENABLED=false` (404, router not mounted).
- **requests the form cannot express.** `criteria_override`, a hand-written
  `solution_text`, a deliberately malformed body, a task number that does not
  exist, an empty `images` list — the validation errors are the point.
- **feature overrides as three-state chips.** Click cycles *absent → true →
  false → absent*, and the chosen set is written into the request body's
  `features`. Absent is the default on purpose: an omitted flag means "use
  what the deployment configured", so pinning all nine would freeze a run
  against later default changes. `⚑` marks a toggle that changes which stages
  run, `$` one that changes a provider parameter and therefore the bill.

It is a client, not a bypass. The page is static and served whether or not the
toolkit is on; it holds no token of its own and opens nothing that a `curl`
with the same header would not. There is a test for exactly that
(`test_console_page_does_not_weaken_the_gate`).

## Endpoints

| endpoint | what it is for |
|---|---|
| `POST /debug/grading/preview-prompt` | the exact prompt, no model call, no cost |
| `GET /debug/llm/traces` | last N calls: prompt, reply, usage, retries |
| `GET /debug/llm/traces/{id}` | one call in full |
| `DELETE /debug/llm/traces` | empty the buffer |
| `POST /debug/grading/sample` | grade a built-in work end to end |
| `GET /debug/samples` | the built-in works |
| `POST /debug/llm/echo` | raw prompt playground |
| `GET /debug/llm/health` | live probe + learned capabilities |
| `POST /debug/llm/mock/*`, `DELETE /debug/llm/mock` | drive the offline provider |
| `GET /debug/config` | effective settings, secrets masked |
| `POST /debug/config/reload` | re-read settings without a restart |
| `GET /debug/tasks` | rubric registry + the verdict JSON schema |
| `GET /debug/reports` | recent runs: scores, tokens, cost |
| `GET /debug/reports/{id}` | one run in full — the file testers send back (`fmt=json\|md`) |
| `GET /debug/pricing` | the rate table cost estimates are computed from |
| `GET /debug/ping` | is the toolkit up, is my token right |

### Prompt preview — the one to reach for first

Iterating on `grading/prompts.py` without spending a token:

```bash
curl -s -X POST localhost:8000/debug/grading/preview-prompt \
  -H 'X-Debug-Token: local-dev-token' -H 'Content-Type: application/json' \
  -d '{"task_number":18,"statement":"Найдите все значения a...","student_solution":"Рассмотрим случай a>0..."}'
```

Returns the rendered messages, `char_count`, a rough `approx_tokens`, and
`criteria_source` — which is `null` exactly when the caller supplied
`criteria_override` and the built-in registry was bypassed. Diff two of these
to see what a prompt edit actually changed.

### Traces — what did we send, what came back

```bash
curl -s localhost:8000/debug/llm/traces?limit=5 -H 'X-Debug-Token: local-dev-token'
```

Each record: full message list, raw response text, parsed verdict, token usage,
latency, attempt count, structured-output mode, notes (retries, downgrades,
dropped parameters) and any error. A grading response returns its
`meta.trace_ids`, so you can go straight from a bad grade to the exact
exchange that produced it.

Bounded by `DEBUG_TRACE_LIMIT` (default 100), in-memory, per-process. Turn off
with `DEBUG_RECORD_TRACES=false`.

### Built-in sample works

Three realistic решения with known-good outcomes, so a fresh environment can be
exercised without anyone typing a maths problem into curl:

| name | what it exercises |
|---|---|
| `13_partial` | correct а), botched отбор корней in б) → should be 1/2 |
| `16_model_error` | economics with a wrong model (% of the original sum) → 0/2 |
| `19_empty` | bare answers, no working → `not_a_solution`, 0/4 |

```bash
curl -X POST 'localhost:8000/debug/grading/sample?name=13_partial' \
  -H 'X-Debug-Token: local-dev-token'
```

Each carries an `expected_score_hint` — what a competent human expert would
award. Not asserted against in tests (a real model is not deterministic), but
it is the seed of the regression corpus in [ROADMAP.md](ROADMAP.md).

---

## Inline levers on a grading request

The same switches, usable without a second call. Silently ignored when the
toolkit is off.

```jsonc
{
  "task_number": 13,
  "statement": "...",
  "student_solution": "...",
  "debug": {
    "force_score": 1,       // skip the model entirely, return this score
    "return_prompt": true,  // attach the prompt that was sent
    "return_raw": true,     // attach the model's raw text
    "seed": 42              // if the provider supports it
  }
}
```

**`force_score`** is the frontend's friend: instant, free, deterministic, no
model involved. Every score band can be rendered on demand — clamped to
`max_score`, and the response is marked `meta.provider: "debug"`,
`debug.forced: true`, with `"модель не вызывалась"` in `meta.notes`. Also logs
a warning server-side. A forced grade cannot be mistaken for a real one.

---

## Reading a grading response

`meta` on every response, no debug flags required:

```jsonc
"meta": {
  "provider": "openai", "model": "gpt-5", "mocked": false,
  "usage": {"prompt_tokens": 1840, "completion_tokens": 420, "total_tokens": 2260},
  "latency_ms": 6210,
  "attempts": 2,                    // > 1 means something was retried
  "structured_mode": "json_schema", // lower rung ⇒ provider lacks schema support
  "samples": 1,                     // GRADING_SELF_CONSISTENCY
  "trace_ids": ["llm_a1b2..."],     // → GET /debug/llm/traces/{id}
  "notes": [...]                    // retries, downgrades, self-corrections
}
```

`notes` is where post-processing confesses. Lines like `score 7 вне диапазона
0..2, приведён к 2` or `verdict 'correct' не согласован с баллом 1` mean the
model produced something impossible and it was corrected. **A rise in these is
a prompt-quality signal** — grep for them.

## Cross-checking a grade

Set `GRADING_SELF_CONSISTENCY=3`: the work is graded three times concurrently,
the median score wins, and the narrative comes from the sample that actually
scored the median. Disagreement is surfaced rather than hidden — `meta.notes`
gets `оценки 3 прогонов разошлись: [1, 2, 2], взята медиана 2` and confidence
is reduced. Those are the works a human should look at. Costs 3× tokens; a
candidate for "only for borderline scores" later.

## Tests

81 tests, all offline, ~2 seconds:

```bash
.venv/bin/python -m pytest
docker compose run --rm --no-deps grading-api python -m pytest -q   # in-container
```

Coverage is organised by risk: `test_llm_client.py` (retries, capability
adaptation, ladder downgrades, JSON repair), `test_postprocess.py` (a model
cannot hand out impossible grades), `test_debug.py` (the gate holds, the tools
work), `test_api.py` (contract, validation, batch isolation).
