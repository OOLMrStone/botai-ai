# Local B2B AI boundary — implementation contract, 16 October 2026

This implementation contract supplements the backend-owned `botai-back/docs/integration/B2B-LOCAL-DEMO.md`.
The new editor document is `expert-review.v2`; old v1 documents remain readable.
Java adapts the AI response to this backend-owned canonical contract.
AI implementation and offline verification are complete. Baseline checkpoint
`28823a0`: **797 passed, 3 skipped, 1 deselected** (legacy live-readiness probe
excluded). The optional-penalty compatibility follow-up passed 169 targeted tests.
The subsequent explicit-circle-path and native-limit changes passed **373 targeted pipeline,
artifact, validator, grade-only, internal-v1 and internal-v2 tests**. No paid calls were made.
Backend/browser end-to-end acceptance and any live smoke remain separately coordinated.

## Service boundary

Use an explicitly versioned `photo-grade.v2` route and response header. Keep the
old photo-grade.v1 boundary isolated. All routes require the existing service token before
body parsing; browsers use only backend routes. Local-demo enablement is off by
default and unavailable in production. Backend owns account/tenant/media access.

For the isolated local runtime use `APP_ENV=local`, `LOCAL_DEMO_AI_ENABLED=true`,
`LOCAL_DEMO_AI_ALLOW_LIVE=false`, `LLM_PROVIDER=mock`, `LLM_VISION_PROVIDER=mock`
and a private environment-only `INTERNAL_GRADING_TOKEN`. V1 enablement is independent.
Do not use production environment settings for the local demo: v2 is deliberately
unmounted there. Discover capabilities without a readiness probe. Model and
package settings are pinned separately from the source commit.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/internal/v2/grading/capabilities` | Supported task packages, contract and input modes; no model probe |
| POST | `/internal/v2/grading` | Prepared trusted task snapshot + ordered student images |
| POST | `/internal/v2/grading/from-images` | Separate task/reference image + ordered student images |
| POST | `/internal/v2/grading/grade-analysis` | Grade completed canonical expert analysis; no OCR or photo stages |
| GET | `/internal/v2/grading/runs/{run_id}/events?after=0&limit=100` | Actual per-run events |
| GET | `/internal/v2/grading/runs/{run_id}/artifacts/{artifact_id}` | Private validated JSON or cropped image bytes |

`X-Request-ID` is the backend run UUID. Prepared multipart retains v1 metadata
fields, with `contract_version:"photo-grade.v2"`. The manual multipart has one
text `metadata` part, exactly one `task_image` file and 1–4 `solution_images`:

```json
{
  "contract_version": "photo-grade.v2",
  "task_version_id": "<backend UUID>",
  "task_id": "<backend UUID>",
  "task_number": 16,
  "task_image_id": "<backend private reference-image UUID>",
  "solution_image_ids": ["<backend student-image UUID>"]
}
```

The manual endpoint extracts the task snapshot from its own image and returns
that snapshot in the final `task`; it never invents a reference answer. The
backend persists the snapshot before exposing a completed run. Reference images
are separate from student images and never included in student-visible artifacts.
Missing/unreadable reference data is an input failure without a score.

### Grade-only compatibility and discovery

V2 capabilities adds
`grade_analysis:{path:"/internal/v2/grading/grade-analysis",contract_version:"expert-grading.v1"}`.
The local backend must explicitly discover this route from v2 capabilities for
tasks 14–20 and retain the returned package and provider provenance. The
existing `/internal/v1/grading/grade-analysis` and photo-grade.v1 capabilities
remain compatible and task16-only; v2 does not implicitly expand v1 support.

The grade-only JSON body is exactly `{contract_version:"expert-grading.v1",
task,ocr_block_ids,analysis}` (1 MiB). `task` is the same immutable trusted snapshot.
`ocr_block_ids` is the ordered list of 1–200 unique canonical block IDs. Analysis
keeps the existing editor schema: required `block_reviews`, `summary`, `checks`,
`student_answer`, `strengths`, `findings`; one review per block and explicit
follow-through references to earlier error blocks. Nullable fields must remain
present. At least a nonblank summary or complete block classification is required.
`expert-review.v2` changes OCR content/title/image only, so its analysis projection
uses this same grade-only wire contract. OCR text, titles, lines, image artifacts,
photographs and the canonical document itself are not sent to this endpoint.

Only the local v2 grade-only route additionally accepts optional
`analysis.findings[].penalty`: a strict integer in `0..task.max_score`. Explicit
zero is preserved; an absent field remains absent in model input (not zero or
null). Explicit null, booleans, floats and strings are rejected before dispatch.
All other analysis fields and references are unchanged. The v1 route continues
to reject this extra field. The server neither sums penalties into a new score
nor modifies the expert's analysis.

Success contains exactly `{"grading":{"score":1,"criterion":"…","explanation":"…"}}`
and `X-Grading-Contract-Version: expert-grading.v1`, even though the local route
uses the v2 prefix. Other provenance headers are unchanged. Both model and HTTP
boundary validate the exact response; no clamping or analysis changes. Live mode
uses the same four-attempt validated-step policy described below, without tools;
exhausted invalid output is a 502 `llm_bad_response` without a grade. V1 keeps its single-call contract. Mock output is explicitly demonstrative.
The local enable/live gates, token, unique run UUID, shared concurrency and
deadline apply. Events reflect actual input/grading/validation boundaries; the
private artifact is the validated grading object. No OCR/analysis events are
invented for grade-only runs. Existing events/artifact GETs retain their v2
transport headers and use the same per-run provenance and retention limits.

## Diagram images

Canonical editor image block (one step retains one ID, status and title, even
when it contains both formulas and a diagram):

```json
{
  "id": "s3",
  "title": "Чертёж и вычисление",
  "content": {
    "type": "step",
    "lines": ["$AB=3$"],
    "image": {"type":"image","artifact_id":"<server UUID>","alt":"Чертёж ученика"}
  },
  "sources": [{"image_id":"<original student-image UUID>","bbox":{"x":0.1,"y":0.2,"width":0.8,"height":0.5}}]
}
```

`lines` is required and preserves the existing LaTeX/text strings. For the image
form shown above it may be empty only when `image` is present. The optional `image`
member is omitted for text-only or structured-diagram steps. `title` is preserved
on the canonical block. One source step
remains one canonical step; splitting its image and formulas would lose its
single status and causal references.

Exact AI step figure:

```json
{"kind":"image","artifact_id":"<server UUID>","alt":"Чертёж ученика"}
```

Geometry uses the image form above. Tasks 14/16 retain PR #4's editable structured
figure fields; these are not converted to image artifacts. V2 circle arcs add the
explicit path fields described below; number-line and v1 schemas remain unchanged:

```json
{"kind":"number_line","variable":"x","note":null,
 "points":[{"id":"p1","value":"0","included":false,"sign":null}],
 "arcs":[{"from":"p1","to":"+inf","sign":"+","selected":true}]}
```

```json
{"kind":"unit_circle",
 "points":[{"id":"p1","value":"π/2","included":true,"sign":null},
           {"id":"p2","value":"π","included":false,"sign":null}],
 "arcs":[{"from":"p1","to":"p2","sign":null,"selected":true,
          "direction":"ccw","full_circle":false}]}
```

Point optional `bound:true` represents a dashed domain boundary and allows
`included:null`; otherwise `included` is boolean. Arc endpoints must reference
point IDs (plus `-inf`/`+inf` only on number lines). Signs are `+|-|0|null`.
Server validation retains the exact figure inside the unchanged OCR snapshot.
Each v2 circle arc requires `direction:"cw"|"ccw"` and `full_circle:boolean`.
Direction specifies the geometric path from `from` to `to`, not whether an arrow
was drawn. `full_circle` is true exactly when endpoint IDs are equal; both
directions represent the same geometry for a full turn. The model must read the
path from the transcript or original photo, never assume CCW from endpoint order.
Missing, null or inconsistent path fields fail layout validation; at most two
format repairs are permitted, then the request fails without a grade. No default
direction/full-turn value is inserted. The final boundary independently checks
these fields and their identity with the reader snapshot. A private validation
copy removes the extensions solely to reuse the unchanged v1 shape validator;
the actual model result, OCR artifact and response keep them exactly.

The original `from`, `to`, `sign`, `selected`, point `value`, `included`, `sign`,
optional `bound` and number-line `variable`/`note` remain intact. The agreed canonical
adapter passes these fields through inside `step.diagram`, renaming only `kind`
to `type:number_line_v2|unit_circle_v2`. Number-line points retain their supplied
order and sparse arcs/loops; no scalar evaluation, sorting or invented intervals.
The frontend owns circle-view parsing of raw labels; an unknown angle requires
manual clarification rather than a fabricated coordinate. One stable step ID
continues to cover its formulas, diagram and review.

Native v2 limits, enforced at layout and final validation: at most **64 points**
and **128 arcs** per figure; point ID <=128 characters, `value` <=500,
number-line `variable` <=64 and `note` <=2000. All these strings are nonblank;
`note` may instead be null. Point IDs are unique within a figure and cannot be
`-inf`/`+inf`. Optional `bound` is boolean; `included:null` is allowed only with
`bound:true`. The layout response is also bounded at 256000 UTF-8 bytes and each
stored JSON artifact at 1 MiB. Exceeding a limit enters the same bounded layout
repair budget; output is never truncated. These caps do not alter the v1 schema.

Exact internal artifact metadata in the final top-level `artifacts` array:

```json
{
  "id":"<server UUID>",
  "kind":"diagram",
  "source_image_id":"<original student-image UUID>",
  "bbox":{"x":0.1,"y":0.2,"width":0.8,"height":0.5},
  "media_type":"image/jpeg",
  "byte_size":12345,
  "width":800,
  "height":500,
  "sha256":"<64 lowercase hex characters>"
}
```

The final top-level keys are exactly the seven existing response keys plus
`artifacts`. This array is empty when there are no diagram crops and on rejection.
For graded v2, OCR is always an object and every status contains
`follows_from_step_ids`. All referenced artifact IDs must belong to the same run;
every diagram artifact must be referenced by an OCR step. Multiple steps may
refer to the same original source image. Artifact binary bytes are retrieved
through the authenticated artifact endpoint, not embedded in JSON or a model URL.

The backend exposes `imageArtifacts` on work, SchoolSubmission and developer DTOs:
`{id,mimeType:"image/jpeg",previewUrl,width,height}`. It retains source provenance,
crop coordinates and checksums privately, and owns preview authorization and the
media lifecycle. Browser content never
contains a model-provided URL, filesystem path, storage key or executable markup.

Detection returns only a supplied `source_image_id`, normalized crop coordinates
`{x,y,width,height}` and optional alt text. All coordinates must be finite in
0..1, dimensions positive, x+width and y+height <=1. Server verifies source belongs
to this run, crops the normalized source pixels and assigns the artifact UUID.
No drawing reconstruction or image generation. The backend copies approved
artifacts into its existing private media ownership lifecycle before publishing
the work. Temporary AI artifact retention/size limits must be pinned before use.

For causal status adaptation, v2 requires `follows_from_step_ids` on each
status: empty except `consequence`, where it names previous `error` steps.
References must be complete, unique, resolve to this OCR snapshot and never be
inferred by the frontend from proximity or wording.

## Observable facts

Internal event page:

```json
{
  "items": [{
    "seq": 1,
    "run_id": "<backend run UUID>",
    "type": "stage_started",
    "phase": "ocr",
    "created_at": "<UTC ISO8601>",
    "data": {"attempt": 1}
  }],
  "next_after": 1,
  "has_more": false
}
```

Emit phase boundaries around actual task preparation, OCR, layout, analysis,
grading and validation calls. Record call attempt, duration, validation issue
paths/codes, retry facts, terminal outcome and validated artifact IDs. Cursors
advance only through delivered events. Connect the observer to **both** prepared
and manual internal runs; standalone `/local/events` does not observe them.

Safe artifact documents contain validated OCR/analysis/grading. Exclude raw
provider requests/responses, prompts, headers, secrets and `reasoning_content`.
Backend projects its own camelCase event DTO, checks actor scope and whitelists
data rather than forwarding arbitrary observer payloads.

### Step retries and failure diagnostics (21 October 2026)

`retry.py` owns **four total attempts per validated step**: task preparation,
each individual photo strip, strip join, each doubtful fragment, layout, analysis,
grading and local grade-only. No nested SDK retries or whole-pipeline replay.
Completed predecessors remain in memory. Both malformed completed responses and
transient connection/timeout/429/5xx failures use this same budget. Authentication,
configuration, invalid input, programming errors and cancellation stop immediately.
Transient failures back off by 0.25/0.5/1 seconds. The shared request deadline is
still at most 360 seconds: if it expires before four attempts, report a deadline
with the actual attempt and previous failure counts, never four model failures.
If diagnostic storage fails, stop further model dispatch rather than spend tokens
without a trace; retain the original failure and the reserved terminal event.
A network retry may cause another provider charge if its earlier response was lost;
backend does not resubmit the entire grading POST on uncertain dispatch.

Validation repair messages describe the failed format while preserving approved
rubrics. Truncation preserves its own reason and does not append incomplete output
or a false format-repair instruction. Analysis may increase an actual lower output
limit to 32000 on its next attempt; at 32000 or above it retries within the same
four-attempt budget without increasing the limit. No non-thinking fallback or
score normalization is introduced. The answer-consistency recheck shares the
same grading budget; an older candidate is never revived after a failed recheck.

OCR join validates notation, uncertainty markers and downstream transcript bounds
before layout. An unsuccessful join never releases overlapping strips as a result.
Doubt resolution requires two matching votes out of three, up to six locations;
one attempt is one three-vote batch for that location (at most twelve calls per
location). Transport failure interrupts that batch; already resolved locations
are retained. Missing candidates trigger independent fragment reads with the lone
suggestion hidden. Selected fragments are validated in their surrounding text.
No uncertain guess is promoted merely because it is the only candidate. Legacy
recovery is unchanged. Final validation is a deterministic integrity guard over
already validated stage outputs, not another model step.

HTTP status and string `error.code` remain compatible. `error.details`, validation,
retry and terminal events carry only safe facts: `failure_category`, `diagnostic_code`,
`reason_code`, actual `phase`, bounded `step`, `attempt`, `max_attempts=4`,
`failure_counts`, `retryable`, `exhausted`, `issue_codes`, `issue_paths`.
Retry events name the upcoming attempt; model events identify that step attempt,
with distinct `call_id` values for its calls. Missing evidence is omitted.
The terminal phase is the actual failed phase, never hardcoded to `validation`.
Counts distinguish mixed failures (e.g. two network and two model responses).
Diagnostic numbers are **not HTTP statuses**:

| Range | Category | Examples |
| --- | --- | --- |
| 3xx | input | 301 invalid input |
| 4xx | network | 401 connection, 402 provider timeout, 403 interrupted upload |
| 5xx | provider | 501 rate limit, 502 unavailable provider |
| 6xx | model_response | 601 invalid response, 602 truncated, 603 empty, 604 OCR ambiguity, 605 notation, 606 source coverage, 607 analysis, 608 grading |
| 7xx | configuration | 701 provider auth, 702 invalid provider request, 703 local contract/package configuration |
| 8xx | timeout | 801 whole-run deadline |
| 9xx | internal | 901 internal failure, 902 local capacity busy, 903 trace storage full (`run_store_full`) |

Backend retains these facts in its event storage and exposes a nullable camelCase
`failure` on failed runs. Frontend uses category/phase/actual attempt for its message;
legacy records without these facts are not retroactively classified. Safe HTTP
error details provide a fallback when the event observer misses a terminal event.

Layout repair feedback identifies missing/duplicate source IDs, unknown-ID
positions and the first sequence mismatch. It does not insert, sort or deduplicate
the returned layout. The original exact coverage and order condition remains
mandatory. Events expose bounded issue codes and paths, never model text.
Retryable transport failures use the step budget above. All calls share the request
deadline (at most 360 seconds).
Provider failures distinguish `error_code=provider_output_truncated` from
`provider_empty_choices` in model-failed events; the public error remains
`llm_bad_response`. Console and JSON logs retain bounded finish reason, output
token count, reasoning token count and requested output limit, without response
text, reasoning text, images or credentials. Transport timeout remains `llm_timeout`.

Evidence is private, process-local memory: TTL 30 minutes, at most 32 runs and
128 MiB overall, 512 events/run, eight diagrams plus eight JSON artifacts/run,
at most 1 MiB each artifact. Expiry is checked on access and every 30 seconds.
The backend must copy approved crops before expiry; restart loses temporary AI
evidence. No raw provider text, reasoning, credentials or original input filenames
are persisted in this store. Stage failure events never claim successful completion.

After durably saving the terminal outcome and finishing event/artifact copying,
backend acknowledges a run with authenticated `DELETE /internal/v2/grading/runs/{id}`.
This returns 204 and immediately deletes the terminal run's event and artifact
payloads, releases their byte budget and normally frees its run slot. Artifact and
event reads then return 404. Creating or validating final JSON alone does not delete
anything: backend must first durably copy the result and required evidence.
Active ACKs return 409; missing or expired UUIDs return 404. Repeated ACKs return 204
until the original TTL, and duplicate run UUIDs remain rejected with 409.
Bounded UUID tombstones (4096, original TTL) preserve this idempotency. If that map
is full, evidence is still deleted immediately; only an empty acknowledged receipt
remains in the bounded run table until a tombstone slot or its TTL becomes available.
That rare saturation can reduce admission capacity, but never retains acknowledged
image/JSON/event payloads or evicts a live UUID guard. Backend records successful
ACKs durably; unacknowledged evidence remains available until its original expiry.

Capabilities expose `concurrency` and `available_run_records`. The B2B backend
uses one FIFO database queue for full checks and expert grade-only jobs, with an
effective limit equal to the smaller of its configured limit and AI concurrency.
`B2B_AI_CONCURRENCY` sets both sides in the local Compose stack (1–8, default 1).
Waiting jobs do not consume the execution deadline; a freed slot immediately
admits the next job. An uncertain dispatched POST is not replayed and retains its
reservation until the upstream deadline or terminal ACK. An early busy response
does not allocate a retained AI record. The durable queue and reservation contract
are documented in backend `docs/integration/B2B-LOCAL-DEMO.md`.

Offline capacity measurements on 21 October used the real ASGI pipeline with a
delayed mock provider and synthetic JPEGs. Four 20-megapixel photos per request
produced peak process RSS of 309/478/1015/1427 MiB at concurrency 1/2/4/8.
With the current 512 MiB AI container, 2 has insufficient reserve and 4 exceeds
the limit. The operational default therefore remains 1; concurrent submissions
wait in the backend queue. These macOS process measurements are risk evidence,
not a Linux container or real provider/network capacity certification. A higher
limit requires representative load measurements and sufficient memory headroom.

New layout/causal instructions and the preserved grade-only instruction passed
both required Astra reviews (structure and unnecessary clarifications). Existing
approved task/common prompt files remain byte-for-byte unchanged.

## OCR notation and explicit native diagrams

The v2 reader and strip join request TeX for formula transcription, preserving
all visible terms, signs, exponent scope and student errors. Narrow offline
checks reject Unicode scripts and explicit `(numerator)/(denominator)` forms;
simple ASCII `x>0` remains valid. A malformed transcription gets the existing
four-attempt step budget with exact diagnostic codes; exhaustion stops before layout.
No server-side formula rewriting or mathematical inference is performed.
The resolved transcript is checked again before layout.

For native-diagram tasks 14/16 an explicit bracket-and-colon marker for a
number line (including `интервальная прямая`) or unit circle requires the
matching native `figure` on the step owning that line. An ordinary prose
mention does not. Layout repair retains all source line IDs exactly once and
in order; source strings still come verbatim from the immutable transcript.
Geometry tasks retain their original-image crop contract.

Verification: 95 focused notation/pipeline tests and 937 full offline tests
passed (3 skipped, 1 live-readiness probe deselected). Both required prompt
reviews completed; a malformed native `kind` regression was fixed and tested.
No paid model calls or runtime changes were made for this checkpoint.


## Deterministic formula validation and reversible figures — 21 October 2026

All existing task packages 14–20 are advertised only after the normal package
presence/digest/error-catalog checks; task maxima remain those in `MAX_SCORES`.
Prepared, from-images and expert grade-only use the same supported set.

`LOCAL_DEMO_AI_FIGURES_ENABLED=false` is the local v2 default. Layout then requests
`figure:null`, validates that restriction, and retains source descriptions as text.
It does not require native number lines/circles, produce crops or diagram artifacts.
The original photographs still enter OCR, join, doubt resolution and layout. Set
this one flat environment value to `true` to restore the existing native/crop path;
its code and approved task prompt files are retained unchanged.

`app/grading/tex_validation.py` batches produced text through the offline Node
helper `app/grading/katex_runtime/validate.cjs`. KaTeX is pinned to **0.16.22** by
package-lock, matching frontend. Rich-text segmentation mirrors frontend
`grid-rich-text.ts` (dollars, escaped dollars, parenthesized/bracketed delimiters and
bare math lines); prose is not parsed as TeX. Native diagram labels, when enabled,
are direct math fields. Render options match frontend: `htmlAndMathml`, `trust:false`,
`maxExpand:1000`, `maxSize:10`, and each segment's display mode. Only diagnostic
`throwOnError:true` differs from the display component's graceful fallback.
Unclosed delimiters left as prose by the frontend are likewise not math segments.

The producing stage checks TeX after its structural validator: preparation, each
OCR strip/join, doubt-fragment consensus, layout titles/labels, analysis text/status
notes, and grading/corrections. Invalid TeX produces `model_response`, code **609**,
reason `invalid_tex`, and retries that stage within its existing four-attempt budget.
Previous stages are retained. The validator never repairs strings or evaluates
mathematical correctness. Expert grade-only validates its produced grading text
and retries only `grading.expert`. No new model-dependent validation stage exists.

Missing Node/dependency, process failure or validator timeout produces configuration
code **704**, `tex_validator_unavailable`; it does not spend four model attempts.
The child receives no provider credentials, no network service is used, and JSON is
passed on stdin without shell interpretation. Limits: one child at a time per
application event loop, 64 MiB Node old-space heap, 512 KiB JS stack, five-second
execution timeout, 1 MiB input, 4096 text/formula entries, and at most 30 safe issue
paths in a bounded response. Timeout/cancellation kills and reaps the child. The
heap cap is not a total RSS cap; the existing container memory limit remains the
outer resource bound. A synthetic single-formula macOS run measured about 45 MiB
peak RSS and 0.05 s; this is not a production/container capacity certification.

Local source tests require Node and `npm ci --ignore-scripts --prefix
app/grading/katex_runtime`. Runtime export includes helper, lock and KaTeX license,
excludes local `node_modules`, and its Docker multi-stage build uses `npm ci` to
install the pinned dependency and Node 22. No frontend dependency was added.
