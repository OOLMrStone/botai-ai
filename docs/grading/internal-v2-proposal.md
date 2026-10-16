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
tasks 14/16/17/18 and retain the returned package and provider provenance. The
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
makes one provider call with no tools or transport replay; invalid output is a
502 `llm_bad_response` without a grade. Mock output is explicitly demonstrative.
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

Retries stay inside each documented bounded stage budget and the shared request
deadline. No transport replay after uncertain dispatch. Structured v2 exhaustion
fails without a grade; do not silently return legacy string OCR under v2.

Task preparation, layout, analysis and grading each permit two format repairs.
For analysis only, a completed provider response with `finish_reason=length`
may use the next existing repair slot with an output limit of 32000 tokens,
once, if the actual previous limit was smaller. Truncation does not append a
format-repair instruction or partial output. Truncation at 32000 or above,
an exhausted repair budget or a second truncation after escalation fails without
a grade. The per-call override does not mutate shared provider settings.
Grading may additionally perform one answer-consistency recheck without resetting
its repair budget. OCR strip/join reading permits one format retry per call;
an unsuccessful join never falls back to overlapping strips. Doubt resolution
requires two exact votes out of three and supports at most six doubtful locations.
V2 markers with fewer than two distinct alternatives trigger three independent
fragment readings from the original photos, with the lone suggestion hidden.
Only two matching bounded JSON readings resolve the fragment; null, malformed
responses and lack of consensus fail without a grade. Legacy recovery is unchanged.
Malformed marker boundaries fail before dispatch. No uncertain guess is promoted
to a final reading merely because it is the only candidate.

Layout repair feedback identifies missing/duplicate source IDs, unknown-ID
positions and the first sequence mismatch. It does not insert, sort or deduplicate
the returned layout. The original exact coverage and order condition remains
mandatory. Events expose bounded issue codes and paths, never model text.
Transport failures propagate immediately in v2, including OCR and doubt voting.
All calls share the request deadline (at most 360 seconds).
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

New layout/causal instructions and the preserved grade-only instruction passed
both required Astra reviews (structure and unnecessary clarifications). Existing
approved task/common prompt files remain byte-for-byte unchanged.
