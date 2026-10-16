# Structured JSON audit — 16 October 2026

PR [#4](https://github.com/OOLMrStone/botai-ai/pull/4), head
`95b2b689bdd7389774b4f8f356eeb4956496cecd`, was merged into `staged-16` as
`8df31ba048e2ee8b7b4bd5a1921d3cca360d7b6f`. Both commits have tree
`47d03ac437eec3a2f91920a23521660cbf368c02`. This audit covers that exact tree.
At verification, PR #3 remained open and `main` was `9c0e373833433f3c7226b8d871766fc15a31969b`.

The original `codex/local-direct-app` checkout and its uncommitted expert
grading-only implementation were preserved. The PR snapshot is separate from
the local fix branch `codex/structured-json-validation-fixes`.

## Actual response and integration boundary

The final response retains `task`, `solution_image_ids`, `is_graded`,
`rejection_reason`, `ocr`, `analysis`, `grading`. For structured success,
`ocr = {steps:[{id,type,title,lines,figure}],answer}` and each step has one
`analysis.statuses` entry `{id,status,note,correct?}`. Statuses are
`ok|error|consequence|minor`. Error cards add `step_id` and `penalty`.
Rejection has null OCR/analysis/grading and no score.

This differs from the editor's `expert-review.v1` block model. In particular,
`consequence` has no causal step references, while the editor's `follow_through`
requires earlier error references. An adapter must not invent them.

The internal API still advertises `photo-grade.v1`, despite accepting structured
OCR, and its capability registry still enables only task 16. The staged engine
and standalone route have packages for all 14–20. Versioned integration must
not equate these different capability boundaries.

## Local fixes

- Initial malformed/truncated grading output now enters the same two-repair
  budget as invalid fields. Transport failures are not blindly replayed.
- Once an answer recheck is required, its invalid response cannot revive the
  earlier grade. It must be repaired or fail without a result.
- OCR voting requires two exact matching votes. Provider failures, ambiguous
  replies and exhausted doubt limits do not select the first alternative.
- Structured stage and final validators handle malformed nested JSON types as
  validation errors. Required nullable members cannot silently disappear.
- Empty steps without figures are rejected. Final error/consequence steps need
  corrected records; minor/consequence cards cannot deduct points; error links
  cannot point at correct steps.
- Stage parsers reject duplicate keys. The expert CLI's `final` mode validates
  the full response and the reader snapshot, rather than only OCR/statuses.

No approved prompt files were edited. This patch does not certify mathematical
correctness and does not clamp scores.

## Resolved local v2 integration requirements

- The existing intentional fallback can return a validated **legacy string**
  OCR after structured layout/status failure. The new v2-only endpoint requires
  structured success and fails after its repair budget; v1 behavior remains separate.
- `drift_errors` checks produced lines against the transcript but does not prove
  complete ordered coverage, answer provenance or figure fidelity. A source-span
  contract now binds every original nonblank line ID exactly once in order and
  copies its text server-side. The answer is extracted from that reader snapshot.
- Current `figure` supports number lines and circles, not private image
  artifacts. V2 geometry diagrams are crops of original normalized photos,
  with server-assigned IDs and backend-controlled access. Number lines/circles
  retain their original structured JSON and one mixed formula/figure step ID.
- This PR has no stage observer on internal runs and no authenticated manual
  task-image endpoint. Both are implemented locally; the authoritative boundary is
  [internal-v2-proposal.md](internal-v2-proposal.md).
- The old checkout's `expert-grading.v1` route was ported without altering that
  checkout. A local v2 route accepts the same analysis contract for 14/16/17/18,
  with explicit discovery. V1 support remains task16-only.

Backend adapts the exact AI figure union into one canonical editor step and owns
private image DTOs/media access. End-to-end browser acceptance and the authorized
single live smoke remain outside this offline AI checkpoint.

## Inputs already available in this tree

| Project task | FIPI-2026 task | Problems | Student cases | Student PNGs |
| --- | --- | --- | --- | --- |
| 14 | 13 | 6 | 22 | 25 |
| 16 | 15 | 6 | 21 | 21 |
| 17 | 16 | 6 | 21 | 32 |
| 18 | 17 | 6 | 19 | 31 |

Manifests are `tasks/N/evals/fipi/manifest.json`. Their referenced files exist.
Problem PNGs contain statements and reference answers; full reference derivations
remain in the original 259-page FIPI PDF. Hidden `expected.json` scores/verdicts
are evaluation labels and must never enter model inputs. No new crop set is needed.

## Offline evidence

Baseline: 543 passed, 3 skipped, 1 deselected. Local checkpoint `28823a0`: **797 passed,
3 skipped, 1 deselected**. The excluded test is the legacy live-readiness probe.
All runs used mock providers; no paid model calls, push or deployment occurred.
Fault injection covers malformed first responses, bounded exhaustion, stale-grade
prevention, failed OCR votes, duplicate keys, malformed nested structures/Unicode,
ordered source coverage, structured figure preservation, source crops, exact causal
references, actual call attempts, cancellation, private artifact scope, deadline,
capacity/retention, both input modes and compatible grade-only runs.

The subsequent canonical-v2 optional `findings[].penalty` compatibility change
passed 169 grade-only/internal-v1/internal-v2 tests. Values remain strict integers
within the task maximum; explicit zero and absence survive provider projection
unchanged, and v1 still rejects the field. No score is recomputed from deductions.

The v2-only circle path and native-limit follow-up passed 373 targeted tests. Circle arcs now require
explicit `direction` and `full_circle`; missing/ambiguous paths exhaust the bounded
layout repair budget without a grade. Both layout and final validation preserve
the exact supplied fields. Legacy/v1 and number-line shapes remain unchanged.
Both required prompt reviewers approved the added circle-only instruction.
Agreed v2 caps (64 points, 128 arcs, bounded IDs/labels/notes) are enforced both
before analysis and at the final gate, with no truncation or changed v1 behavior.

## Local live-smoke failures and bounded recovery

Run `5a320c3e-3ac9-4dfe-acf2-186631a179fb` completed three OCR strip reads and
one whole-photo join with HTTP 200, then failed with `llm_bad_response` in
`resolve_doubts`. The call sequence and singular error message identify the
fewer-than-two-distinct-alternatives branch. The join instruction allows an
unresolved marker without requiring two alternatives; the previous resolver
rejected it immediately. Original provider bodies were not retained, so the
exact disputed text and its location cannot be reconstructed from this run.

V2 now permits bounded independent visual recovery for that marker; the exact
contract is in [internal-v2-proposal.md](internal-v2-proposal.md). A synthetic
pipeline regression reproduced the same old exception before the fix and
passed afterward. Recovery never accepts the original lone suggestion without
consensus. Failure still produces no grade; it is not evidence of poor photo
quality, and the UI may report that AI could not complete the check.

Matching FIPI 15.1.1 run `34a9544d-9f45-4444-8eee-4648a64e5d25` completed OCR,
then exhausted all three layout attempts at `$.steps.line_ids`. Every other
layout validation passed. The old generic diagnostic cannot distinguish omitted,
repeated, unknown or reordered IDs; raw responses were not retained. The patch
adds bounded actionable repair facts and distinct safe event codes while retaining
the exact acceptance condition and two-repair budget. No automatic insertion,
sorting, dropped OCR lines or legacy-string fallback is introduced.

An offline SDK serialization probe confirmed image bytes remain intact in user
`image_url` parts with `detail: high`. The current DeepSeek alias supports image
input according to the official [vision guide](https://api-docs.deepseek.com/guides/vision/)
and [model documentation](https://api-docs.deepseek.com/). This run's four HTTP 200
responses do not support an image-transport failure. The current service uses
`LLM_*` throughout, as documented in [service.md](service.md); legacy
`LLM_VISION_*` overrides are not a separate model selection in this pipeline.

Separate limitation, not the observed failure: generated enlargements may exceed
the provider's side-length limit for very tall valid inputs (a synthetic
500×5000 image becomes 2000×20000). No image-size or provider-setting changes are
included in this OCR/layout patch.

Historical comparison: the [15 October FIPI summary](../../tasks/16/evals/results/2026-10-15-staged/fipi-summary.json)
records the same 15.1.1 case graded 2 in 118.653 seconds, request
`req_31de2d80fcd64b99`; see its [run description](../../tasks/16/evals/full-run-2026-10-15.md).
Between staged commit `865868ea6911af9f31811636b0d76c6869d7ade2` and accepted
`131fd79`, `reader.py`, `images.py`, task-16 `ocr.md` and `ocr_biases.md` are
byte-identical; `Provider.transcribe` has an identical AST. Historical full
runtime settings were not retained, so complete configuration equality is unknown.
That older staged flow went directly from reader to analysis and grading, without
mandatory doubt resolution, structured layout or source-ID coverage. The new
failures occur at these added completion requirements; weakening them or assuming
the photograph became unreadable is not an evidenced remedy.

Both required prompt reviewers approved the new reread instruction and specific
layout repair feedback. The full offline suite passed **887 tests, 3 skipped,
1 deselected**; the excluded case remains the live-readiness probe. The new
checks cover independent votes, abstention, malformed/duplicate JSON, Unicode
line separators, uncertainty retention, no transport replay, legacy compatibility,
actionable layout feedback and exhaustion without a grade.

The single authorized matching FIPI 15.1.1 preflight on this patch completed
successfully: run `97fc3a0e-7776-4d68-8183-f65b3e9cc0a7`, `is_graded=true`,
score 2/2, 71.93 seconds. OCR, layout, analysis, grading and final validation
all completed. No retry was needed, so this live success does not itself exercise
the new recovery or demonstrate elimination of stochastic layout failures.
Those paths are covered by offline fault injection. The prepared task came only
from the demo manifest's statement/reference answer and its matching student PNG;
hidden expected scores were not model inputs. Private evidence remains outside
Git and runtime exports. This was a direct pipeline preflight, not backend/browser
end-to-end acceptance, and the existing container was not changed.

## Analysis completion limits and diagnostics

Browser run `144b68de-2fa6-4455-b86e-1f268311282d` on `8553ac1` completed OCR
and layout but all three analysis calls raised `llm_bad_response` inside the
provider adapter, after HTTP 200. Their durations were 84.277, 86.520 and 80.835
seconds; the analysis stage failed after 251.637 seconds. The adapter raises this
exception before exposing content only for `finish_reason=length` or missing
choices. Thus these were not parser rejections of an otherwise returned analysis
and not transport timeouts. The console formatter previously discarded finish
reason and token-count extras; the exact historical branch cannot be recovered.

Verified local runtime: `deepseek-v4-flash`, 16000 output tokens for chat, 8000
for transcription, timeout 360 seconds, SDK retries zero, shared deadline 360
seconds, no thinking/effort overrides. OCR/layout explicitly disable thinking;
analysis/grading use provider defaults. DeepSeek documents default enabled/high
thinking in its [guide](https://api-docs.deepseek.com/guides/thinking_mode/).
The prior preflight inherited the then-running container settings; the same
`live.compose.json` predates it and still specifies 16000/360/zero retries.
A complete historical environment snapshot was not saved, so full equality is
not asserted. Backend separately reports production's 32000 output-token limit.
Truncation is a supported hypothesis for this run, not a proven finish reason.

The follow-up preserves bounded finish/token facts in console as well as JSON
logs and adds distinct safe causes to model-failed events. Analysis may recover
one confirmed truncated response using the next existing repair slot at 32000,
as specified in [internal-v2-proposal.md](internal-v2-proposal.md). It never
returns partial content, changes grading validation, retries uncertain dispatch,
extends the deadline or mutates provider settings. The existing 8553ac1 live
preflight does not validate this new truncation path; it requires its own
coordinated verification after offline checks and installation.

The follow-up passed **904 tests, 3 skipped, 1 deselected**. An independent
review approved the bounded recovery and verified 71 targeted tests. Coverage
includes actual SDK output-limit forwarding, safe console/event diagnostics,
missing choices, single escalation, shared repair budgets, initially larger limits,
transport failures, cancellation and unchanged default settings. No additional
paid call, runtime restart or production change was made for this follow-up.
