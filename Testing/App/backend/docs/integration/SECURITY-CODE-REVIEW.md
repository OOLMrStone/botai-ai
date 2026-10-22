# Independent security code review

2026-10-05. Reviewed FROZEN SPEC v1.4 and the v1.5 UI-only HOME-label amendment, security-review, BACKEND-HANDOFF, GRADING-IMPLEMENTATION, ai-contract, runtime-plan, applicable AGENTS and actual backend/AI/frontend-boundary/runtime code. Product code was not changed. This is a bounded independent gate, not a claim of exhaustive security or production approval.

**Gate after narrow re-review: PASS for the reviewed local isolated mock stack and proceeding to an equally isolated mock staging smoke. No open code blockers from this review. This does not certify a server deployment, browser acceptance or public/live production release.** SSH/production were not touched. No paid provider calls or `probe=true`; live AI container was independently verified as mock/mock, debug=false, with only an internal network and no published ports.

## Findings closed by narrow re-review

### Closed P1 — daily AI quota used intent creation time instead of admission time

Before the fix, `src/main/java/org/botai/back/grading/SubmissionService.java:53` counted `package_id IS NOT NULL AND created_at > now()-interval '24 hours'`. `created_at` is the durable draft creation time; admission at line54 updates only `updated_at`. `media/MediaService.java:39` expires drafts by **updated_at**, which uploading/deleting photos refreshes. Thus a user can retain drafts older than24h and submit them today without consuming today's admission counter.

Independent local reproduction used a new isolated synthetic Pro account. Thirty prior admissions were modeled as cancelled submissions created25h ago, with today's `queued` audit events. SQL returned **today's admissions30 / current quota count0**. A valid photographed #16 submission then returned **HTTP200 status=queued on admission31**, instead of429. It was cancelled; the dedicated account was disabled afterward. No shared account roles, volumes or history were reset.

Fixed at `SubmissionService.java:54–55`: count owned submissions with immutable `queued` events in the rolling24h window. Both comparison and inserted admission use `clock_timestamp()` after the existing user/admission locks; event, queue and status commit atomically. Cancel/failure preserve the charge, retries need a new admission, repeated finalize does not charge again. No migration changes. Independently confirmed below.

### Closed transport blockers

- AI capabilities now emits exact integer360 and safely rejects incompatible configured deadlines, including fractional values, without changing timeout settings. Backend strict integer/schema validation remains intact. Reviewer independently ran the3 focused capability tests successfully.
- `grading/HttpGradingGateway.java:24` explicitly selects HTTP1.1. Redirect/retry restrictions, total timeout/response cap and per-response run/contract/package/provider/schema validation are preserved. The reviewer independently completed an actual rebuilt backend→Garage→Uvicorn mock16 grading run, beyond the Java HTTP-server test.

## Narrow re-review evidence

`/tmp/botai-security-rereview.py` ran against the rebuilt backend18082 using three fresh isolated synthetic Pro accounts; these accounts were disabled afterward. No shared credentials/roles/history were reset. Prior admission history was seeded only for these fixtures; actual finalizations and races used HTTP.

- 30 admissions today from25h-old submissions, alternating cancelled/failed:31st finalize429 `daily_grading_limit`, draft preserved and no job created. Explicit linked retry also429.
- 29 admissions followed by two simultaneous HTTP finalizations: exactly one200 and one429; immutable admission count exactly30.
- 30 admission events older than24h with freshly updated submissions: a new real upload was accepted. Actual backend→Garage→AI mock16 result **graded**, `isDemo=true`; repeated finalize produced exactly one new admission and one provider run. Stored package matched the pinned submission, provider mode was mock and response hash was present; public JSON excluded reference/raw/key fields; XP/streak stayed0.
- Reviewed all three new quota regressions and HTTP1/no-upgrade assertion. Independently summed current JUnit XML: **38 tests, zero failures/errors/skips**. The reviewer did not repeat the full Java suite.
- Runtime separately reports `scripts/integration/api-smoke.py` PASS both directly18082 and through frontend same-origin13000 after rebuild, including unsupported14, private media, owner/admin, avatar, auth/CSRF, collections/exam/relogin and demo-no-progress. See [RUNTIME-EVIDENCE.md](RUNTIME-EVIDENCE.md). Server/production and complete browser acceptance remain separate gates.

## Independent evidence

| Boundary | Evidence and result |
|---|---|
| Auth/CSRF | Actual HTTP: anonymous profile/history/admin/media401; USER admin403; missing/wrong/stale CSRF403; login rotates CSRF. SESSION observed host-only, HttpOnly, SameSite=Lax. HTTP-local Secure=false is intentional; HTTPS production remains unverified. |
| Current role/status | Dedicated synthetic fixture: role change invalidates old session401; fresh ADMIN allowed; downgrade gives admin403 and profile401; disabled account profile401. Public profile plan/role/xp/timeZone injection returns400 and free plan stays free. Persisted plan is locked/rechecked before admission. |
| Ownership/public DTO | Actual foreign attempt/submission/media reads and foreign cancellation404. Ungraded solution reveal404. Task/attempt payloads contain no reference answers, accepted answers, raw AI response or S3 key. `AttemptRepository`/`SubmissionStore` explicitly project safe result fields. Daily explicit reveal is separately allowed by SPEC. |
| Uploads/history | Actual MIME-spoofed SVG422 with durable `upload_rejected`; >8MiB multipart413 with durable multipart-phase event. Valid PNG becomes JPEG; owner stream has private/no-store/nosniff; other user404/anonymous401. Invalid requested target preserves rejected intent. Same idempotency key repeats ID; changed input409. |
| Media/storage code | Generated immutable private keys, bounded bytes/dimensions/static formats, two decoder slots, EXIF orientation then re-encode; reservation locks max4 staged+ready, finalize denies staged, READY revision/state CAS; S3 official SDK bounded GET and no retries. Existing four image tests include dimensions and orientations1–8; existing real-S3 JUnit result was inspected, not rerun by reviewer. |
| Queue/result code | HTTP outside transactions; committed dispatch requires claimed state+fence+unexpired lease; acceptance checks same fence/lease; postdispatch expiry terminal unknown, only predispatch requeues. Cancel fences late results. Examined the existing deterministic race tests and35-test JUnit XML (zero failures/errors/skips); did not rerun Java suite here. |
| AI schema/trust | Independently ran `LLM_PROVIDER=mock LLM_VISION_PROVIDER=mock INTERNAL_GRADING_ENABLED=false .venv/bin/python -m pytest tests/test_internal_grading.py tests/test_grading_validator.py tests/test_grading_session.py -q`: **184 tests, exit0**. Auth before parsing, strict duplicate/schema/IDs, provider/package provenance, no prepared OCR, safe errors and preserved session/tool boundaries inspected. Backend binds full task + ordered image IDs + score/schema; raw response retained privately and mock cannot award progress. |
| Operator/network/secrets | Queried live grants: operator cannot SELECT/write users/session/OTP/answers/raw results/stored keys; safe views SELECT only; operator/app cannot CREATE public schema. AI private internal network/no ports and forced mock/debugfalse verified via sanitized inspect. Adminer/PG/S3 exposure reviewed; runtime credentials/env/Garage config mode0600. No secret values printed or written to report. |

The standalone negative HTTP script in `/tmp/botai-security-negative.py` passed9 grouped checks; `/tmp/botai-quota-review.py` reproduced quota and current-role revocation. These scripts read existing ignored synthetic credentials at execution; do not commit runtime credentials or session material. Only fixture data was added.

## Nonblocking for isolated mock staging; required before public/live release

- `compose.integration.yaml` passes `SPRING_FLYWAY_PASSWORD` for the actual superuser `botai_migrator` into the long-lived backend. The connection uses restricted `botai_app`, but this is not credential isolation. Before public deployment, move migrations to a separate one-shot job and omit migrator credentials from application runtime; verify the final process environment by names only. Local mock staging can remain isolated while this is prepared.
- Final HTTPS cookies, trusted ingress/IP-rate limiting, storage encryption/retention, administrator ingress and production backup/restore are deployment gates, not certified by this code review. Existing local tests do not authorize a live switch. The separate runtime/browser reviews own their remaining evidence.

Narrow re-review closes the findings above. Preserve the tested strict contract, private networks, forced mock configuration, user changes, migrations and history when moving to isolated staging. Public/live release still requires the listed deployment conditions and its own final checks.
