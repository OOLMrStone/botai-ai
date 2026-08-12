# The LLM layer

`app/llm/` — provider-agnostic model access. Knows nothing about the ЕГЭ.

## Using it

```python
from app.llm import get_llm_client, Message

client = get_llm_client()

# free-form
result = await client.complete(messages=[Message.user("привет")])
result.text
result.meta.usage.total_tokens

# structured — this is what grading uses
out = await client.complete_structured(
    messages=[Message.system(SYSTEM), Message.user(task)],
    schema=LLMVerdict,          # any Pydantic model
)
out.value          # LLMVerdict instance, already validated
out.raw_text       # what the model literally said
out.meta           # provider, model, usage, latency_ms, attempts, notes
```

`complete_structured` either returns a validated instance or raises. There is
no "maybe it parsed" state for callers to handle.

## What the client handles for you

### Retries

Timeouts, rate limits and 5xx are retried up to `LLM_MAX_RETRIES` with
exponential backoff plus jitter (`0.5s → 1s → 2s …`, capped at 8s, ±30%).
`LLMConfigError` is never retried — no API key will not fix itself.

The attempt count comes back in `meta.attempts` instead of being hidden, and
each retry appends a line to `meta.notes`. The OpenAI SDK's own retry layer is
switched off (`max_retries=0`) so these numbers mean something.

### Capability probing

Providers disagree, and the disagreements are annoying:

- newer OpenAI models want `max_completion_tokens`, older ones `max_tokens`;
- reasoning-family models reject a custom `temperature`;
- many OpenAI-compatible gateways do not implement `response_format` at all.

Rather than maintain a model table that goes stale the moment a model ships,
the client **guesses from the model name, then self-corrects**: on a 400 that
names a parameter, it drops or flips that parameter, retries immediately, and
stores the lesson on the client instance.

Cost: one 400 per process, not one per request. Inspect the current beliefs at
`GET /health/ready` or `GET /debug/llm/health`:

```json
{"token_param": "max_completion_tokens", "allow_temperature": false, "structured_mode": "json_schema"}
```

Pin them explicitly with `LLM_TOKEN_PARAM` / `LLM_SUPPORTS_TEMPERATURE` when
you already know what an endpoint wants.

### The structured-output ladder

`LLM_STRUCTURED_MODE=auto` walks down as needed:

| rung | mechanism | schema reaches the model via |
|---|---|---|
| `json_schema` | `response_format={"type":"json_schema", strict:true}` | the API, provider-enforced |
| `json_object` | `response_format={"type":"json_object"}` | the prompt |
| `prompt` | nothing | the prompt |

It steps down when the provider rejects the format parameter, or when output
fails to validate after a repair round. The rung that worked is remembered, so
a gateway that does not support schemas costs one downgrade, not one per call.

**Both lower rungs put the full JSON schema in the prompt.** `json_object`
guarantees syntactically valid JSON and nothing about its shape — without the
schema in the prompt the model would have to guess the field names.

Set `LLM_STRUCTURED_MODE` to a specific rung to pin it; the ladder is then
disabled and a rejection is an error.

### Strict-schema conversion

OpenAI's strict mode is fussier than JSON Schema: every object needs
`additionalProperties: false` and must list *all* properties in `required`.
Pydantic does not emit that. `llm/schema.py::to_strict_schema()` post-processes
it — closing every object, requiring every key, stripping `default`/`title`.

Consequence for model design: **no `minimum`/`maximum` on schema fields.**
Strict mode ignores them, so they buy nothing and cost a 502 when the model
returns an out-of-range value. Enforce bounds after parsing — for grading,
that is `grading/postprocess.py`.

### JSON extraction and repair

`extract_json()` copes with ```` ```json ```` fences, prose before and after,
and braces inside strings (it walks the string tracking depth and escapes).

If the output still does not validate, the client sends one repair round —
the bad output plus "this was not valid JSON for this schema, error was X,
return only the corrected object". Controlled by `repair_attempts`
(default 1). Only when repair fails does the ladder step down.

### Reasoning models

Models that think before answering break two assumptions the OpenAI shape
does not warn you about.

**The answer may not be in `content`.** Two different behaviours look
identical on the wire:

| behaviour | `content` | where the answer is | seen on |
|---|---|---|---|
| answer misfiled | empty | `reasoning` / `reasoning_content` | nemotron-\*, gpt-oss-\* via OpenRouter |
| still thinking | empty | nowhere — call was cut short | DeepSeek v4 |

`_message_text()` tells them apart by `finish_reason`. Anything else either
discards a good response or hands chain-of-thought to the JSON parser as the
answer.

**Reasoning tokens are drawn from `max_output_tokens`.** A budget that
comfortably fits the answer can still be exhausted before the answer starts.
That failure is *deterministic*: same prompt, same budget, same truncation —
so it is raised non-retryable, naming the setting to raise. Left retryable it
cost four attempts and 341 seconds to reach the identical failure.

Symptom to recognise: a stage that runs for minutes and ends in
`llm_bad_response`, with `/debug/llm/traces` showing empty output and
reasoning that stops mid-sentence. The fix is a bigger budget, never a retry.

### Turning thinking off per stage

`extra_body` is merged into the request body verbatim — the escape hatch for
switches no OpenAI-compatible schema covers. It is set per stage, because the
stages want opposite things:

```bash
LLM_VISION_EXTRA_BODY={"thinking":{"type":"disabled"}}   # stage 1 only
```

Transcription is not a reasoning task. DeepSeek spent 56s and ~11k tokens
thinking about handwriting it had already read correctly; with thinking off
the same stage takes 8s and the transcript is identical. Stages 2 and 3 keep
thinking — finding a lost root *is* the reasoning.

`LLM_VISION_MAX_OUTPUT_TOKENS` exists for the same reason: once stage 1 stops
reasoning it needs a fraction of the budget the text stages do.

**The profile belongs to the stage, not to the endpoint.** When
`reconstruct_first` is off, stage 2 runs on the *vision* client — but it is
still stage 2: it reads the sheet and analyses it in one call, and it needs
what stage 2 normally gets. `PhotoGradingPipeline._borrowed_vision_profile`
restores the text stage's budget and vendor body for that call, borrowing only
the endpoint. Inheriting stage 1's profile instead truncated the call
mid-thought at 8000 tokens and silently disabled the reasoning the analysis
depends on — two failures that look like "the mode is bad" rather than "the
budget was wrong".

### Turning it back on for one run

`complete` and `complete_structured` take `extra_body` too, and per-call keys
win over the settings:

```python
await client.complete_structured(..., extra_body={"thinking": {"type": "enabled"}})
```

The settings say what a stage normally does; the call says what *this run* is
testing. That is how the `deep_think_*` toggles work — they are registry data
(`Feature.request_extra`), not pipeline code, so adding another such switch
needs no edit to `grading/pipeline.py`.

A per-call `None` **removes** a key (RFC 7396 merge-patch). That is the only
way to say "send nothing here": the absence of `thinking` means the provider's
own default, and no value you can send spells that.

**A rejected vendor parameter is dropped, not fatal.** If the provider 400s on
a key that came from an `extra_body` we merged in, the client removes the whole
extra body, retries once, and puts a loud note on the run — including the words
*"this run is NOT the configuration you asked for"*, because a silently
downgraded run would otherwise be reported as a successful benchmark of a
setting that never went out. Unlike `temperature`, the drop is **not**
remembered on `caps`: the next call sends it again.

### Tracing

Every call lands in a bounded ring buffer (`DEBUG_TRACE_LIMIT`, default 100):
prompt, raw response, parsed value, usage, latency, attempts, mode, notes,
error, and `request_extra_body`. Read it at `GET /debug/llm/traces`.
Process-local and non-durable by design — a debugging aid, not an audit log.

`request_extra_body` is there for the toggles that change no prompt text: the
trace is the only place you can confirm the switch actually went out.

### Concurrency

One semaphore per client, sized by `LLM_CONCURRENCY` (default 8). Batch
grading and self-consistency sampling both pass through it.

## Adding a provider

Implement the `ChatProvider` protocol (`llm/providers/base.py`) — one method:

```python
class MyProvider:
    name = "mine"
    async def chat(self, request: ChatRequest) -> ChatResponse: ...
    async def aclose(self) -> None: ...
```

Rules:

1. Raise `app.core.errors.LLMError` subclasses, never provider-native
   exceptions. The client's retry logic keys off the taxonomy.
2. Raise `LLMBadRequestError(..., param="temperature")` with the offending
   parameter name when the provider tells you one — that is what drives
   capability adaptation. `openai_provider._offending_param()` shows how to dig
   it out of both a structured error body and a plain message.
3. Register it in `client.build_provider()` and in the `LLM_PROVIDER` literal
   in `config.py`.

Retries, tracing, schema negotiation and concurrency are the client's job —
do not reimplement them in a provider.

**For an OpenAI-compatible endpoint you do not need a new provider at all** —
set `LLM_BASE_URL` and let capability probing sort out the differences.

## Settings

| var | default | note |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` \| `mock` |
| `LLM_API_KEY` | — | required unless mock |
| `LLM_BASE_URL` | — | set for any OpenAI-compatible gateway |
| `LLM_MODEL` | `gpt-5` | **verify against your provider's catalogue** |
| `LLM_TIMEOUT_S` | 120 | part-2 grading is a long generation |
| `LLM_MAX_RETRIES` | 3 | transient failures only |
| `LLM_TEMPERATURE` | 0.2 | dropped automatically if rejected |
| `LLM_MAX_OUTPUT_TOKENS` | 4000 | |
| `LLM_STRUCTURED_MODE` | `auto` | `auto` \| `json_schema` \| `json_object` \| `prompt` |
| `LLM_EXTRA_BODY` | — | JSON object merged into the request body verbatim |
| `LLM_VISION_*` | — | any of these, overriding stage 1 only |
| `LLM_TOKEN_PARAM` | `auto` | `max_tokens` \| `max_completion_tokens` |
| `LLM_SUPPORTS_TEMPERATURE` | `auto` | `true` \| `false` |
| `LLM_CONCURRENCY` | 8 | semaphore size |

`LLM_MODEL` defaults to `gpt-5` as a placeholder. Model names change; confirm
the id against your provider before deploying, and `GET /health/ready?probe=true`
to check it end to end.
