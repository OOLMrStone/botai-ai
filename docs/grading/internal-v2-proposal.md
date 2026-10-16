# Local B2B AI boundary — implementation contract, 16 October 2026

This implementation contract supplements the backend-owned `botai-back/docs/integration/B2B-LOCAL-DEMO.md`.
The new editor document is `expert-review.v2`; old v1 documents remain readable.
Java adapts the AI response to this backend-owned canonical contract.
AI implementation and offline verification are complete. Baseline checkpoint
`28823a0`: **797 passed, 3 skipped, 1 deselected** (legacy live-readiness probe
excluded). The optional-penalty compatibility follow-up passed **169 targeted
grade-only, internal-v1 and internal-v2 tests**. No paid calls were made.
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
figures verbatim; these are not converted to image artifacts:

```json
{"kind":"number_line","variable":"x","note":null,
 "points":[{"id":"p1","value":"0","included":false,"sign":null}],
 "arcs":[{"from":"p1","to":"+inf","sign":"+","selected":true}]}
```

```json
{"kind":"unit_circle",
 "points":[{"id":"p1","value":"π","included":true,"sign":null}],
 "arcs":[]}
```

Point optional `bound:true` represents a dashed domain boundary and allows
`included:null`; otherwise `included` is boolean. Arc endpoints must reference
point IDs (plus `-inf`/`+inf` only on number lines). Signs are `+|-|0|null`.
Server validation retains the exact figure inside the unchanged OCR snapshot.
The backend/editor extension for a structured diagram alongside `content.lines`
must preserve that one stable step ID; its canonical union is coordinated by
the backend owner. It must not split formulas and diagram into different blocks.

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
Grading may additionally perform one answer-consistency recheck without resetting
its repair budget. OCR strip/join reading permits one format retry per call;
an unsuccessful join never falls back to overlapping strips. Doubt resolution
requires two exact votes out of three and supports at most six doubtful locations.
Transport failures propagate immediately in v2, including OCR and doubt voting.
All calls share the request deadline (at most 360 seconds).

Evidence is private, process-local memory: TTL 30 minutes, at most 32 runs and
128 MiB overall, 512 events/run, eight diagrams plus eight JSON artifacts/run,
at most 1 MiB each artifact. Expiry is checked on access and every 30 seconds.
The backend must copy approved crops before expiry; restart loses temporary AI
evidence. No raw provider text, reasoning, credentials or original input filenames
are persisted in this store. Stage failure events never claim successful completion.

New layout/causal instructions and the preserved grade-only instruction passed
both required Astra reviews (structure and unnecessary clarifications). Existing
approved task/common prompt files remain byte-for-byte unchanged.
