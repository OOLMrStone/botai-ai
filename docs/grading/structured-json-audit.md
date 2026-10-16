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

The v2-only circle path follow-up passed 357 targeted tests. Circle arcs now require
explicit `direction` and `full_circle`; missing/ambiguous paths exhaust the bounded
layout repair budget without a grade. Both layout and final validation preserve
the exact supplied fields. Legacy/v1 and number-line shapes remain unchanged.
Both required prompt reviewers approved the added circle-only instruction.
