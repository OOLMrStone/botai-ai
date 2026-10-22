# Grading/media/admin implementation checkpoint

2026-10-05, SPEC FROZEN v1.4. Continued the existing interrupted implementation; preserved auth/core/V5/V6 and unrelated changes. No production changes or paid AI calls.

## Implemented

- Durable owner-scoped submission intent before business validation/uploads; idempotency conflict detection, invalid-target history, explicit linked retries, client rejection audit, conditional cancellation. Short answers compare server answers with whitespace/decimal-separator normalization; batch checks deduplicate their key and skip missing inputs.
- PostgreSQL queue: atomic enqueue/admission, SKIP LOCKED claims, fences and leases, committed dispatch record before HTTP, no DB transaction around AI HTTP. Expired pre-dispatch claims may requeue; uncertain post-dispatch outcomes fail without automatic inference retry. Late/cancelled results cannot overwrite state or award progress.
- Bounded authenticated HTTP adapter: no redirect/retry, 390-second total deadline, 1 MiB response cap, strict capabilities, per-response contract/run/package/provider headers. Strict duplicate-key/schema/task/ordered-image/score validation; exact validated JSON retained privately, typed camelCase feedback only for students. Mock/synthetic grades excluded from progress.
- Media: official AWS SDK v2, private generated immutable keys, staged reservations capped at four, decode/re-encode JPEG/PNG/WebP, animation/bytes/dimensions/pixel limits, concurrency cap, metadata removal and EXIF orientation before removal, stricter avatar normalization. READY commit rechecks draft/revision, reconciler deletes failed/stale/orphan metadata entries and expires abandoned intents. Photo upload/delete touches attempt updatedAt/revision. Authenticated owner/admin stream uses private/no-store/nosniff; admin detail/media access audited and current role checked.
- HOME: `GET /api/attempts?status=unfinished&cursor=...&limit=...` returns existing `{items: Attempt[],nextCursor}` shape, owner active/checking only, `updated_at DESC,id DESC`, bounded offset cursor. No new title field; frontend derives label from kind/items. Existing history without status preserved. Exact persisted ordered snapshots, answers, drawing, photos, results/currentIndex resume across sessions. Completion requires every item to have an accepted graded result for its current input revision. Missing/rejected/failed/unsupported/cancelled remain resumable.

## Actual validation

Java21 Docker `./gradlew test --no-daemon`, real Testcontainers PostgreSQL17 + Mailpit; final exit0, **35 tests passed, zero skipped/failures/errors**. JUnit XML: `build/test-results/test/TEST-*.xml`.

| Suite | Passed |
|---|---:|
| AuthFlowIntegrationTest | 7 |
| LearningIntegrationTest | 8 |
| UpgradeIntegrationTest | 1 |
| GradingIntegrationTest | 9 |
| AiResponseValidatorTest | 2 |
| HttpGradingGatewayTest | 3 |
| ImageNormalizerTest | 4 |
| S3ObjectStorageIntegrationTest | 1 |

Coverage includes real HTTP login/logout/relogin with two collections plus exam and exact draft/photo/check/index equality; unfinished pagination/order, empty other-account list and foreign404; admin USER403, role downgrade, audit; avatar ownership/removal; durable malformed/S3-failure history; repeated finalize; concurrent workers; staged4 upload race/finalize denial/stale commits; pre-/post-dispatch lease expiry and cancellation fencing; unsupported/error/rejection without zero score; short checks/idempotency/demo exclusion; AI wrong task/image IDs, duplicate keys, score range, provider mismatch; loopback authenticated multipart/run binding, no redirect, oversized response rejection, missing headers; camera EXIF orientations1–8 with pixels/dimensions verified and metadata stripped.

Real **Garage v2.3.0 + official Java AWS SDK** test executed on private `botai-integration-local_data`: normalized solution and avatar PUT/GET byte equality, bounded GET, anonymous GET denied, DELETE then absent. Used local runtime/.env.integration without outputting credentials. The test is opt-in via S3_ACCESS_KEY and skips when absent. Validation container needs both bridge (Testcontainers host/RYUK) and private data network (Garage). An initial combined run on private data only failed Testcontainers initialization; this harness issue was corrected and the entire suite rerun successfully.

`git diff --check` passed. V1–V4 diff against origin/feature/email-ops remains empty.

## Runtime configuration

Spring properties (environment equivalents in parentheses):

- `app.grading.base-url` (`APP_GRADING_BASE_URL`), `app.grading.token` (`APP_GRADING_TOKEN`); empty values fail closed. Private AI internal base URL, never public/browser token.
- `app.grading.worker-enabled=true` (`APP_GRADING_WORKER_ENABLED`); queue-limit100, daily-limit30 (`APP_GRADING_QUEUE_LIMIT`, `APP_GRADING_DAILY_LIMIT`). Worker two concurrent slots, 90s claim lease /420s dispatch lease.
- `app.storage.endpoint`, `bucket=botai`, `access-key`, `secret-key`, `region=garage` (`APP_STORAGE_ENDPOINT`, `APP_STORAGE_BUCKET`, `APP_STORAGE_ACCESS_KEY`, `APP_STORAGE_SECRET_KEY`, `APP_STORAGE_REGION`). SDK path style, checksum WHEN_REQUIRED, one attempt, bounded timeouts.
- `SESSION_COOKIE_SECURE` must be true on HTTPS. Multipart8MiB/file,9MiB/request; avatar authoritative cap2MiB/4MP/4096, output≤512; solution8MiB/20MP/8192.
- S3 test environment is separate: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, optional `S3_TEST_ENDPOINT=http://garage:3900`, `S3_BUCKET=botai`.

## Remaining gates

Independent security review and complete frontend→backend→AI mock browser flow belong to the coordinator/runtime/frontend tasks. This checkpoint proves Java adapter contract tests and real private S3 SDK I/O, not the combined deployed product. Paid/live mathematical quality, production ingress/storage policy, retention/product deletion policy, backups/restore and isolated server smoke are not approved by these tests. Only existing approved AI16 package is supported; no new prompts created.

## Independent-review fixes — 2026-10-05, 01:13 MSK

Addressed SECURITY-CODE-REVIEW P1 quota bypass and reported Uvicorn transport mismatch. No schema change; applied V1–V6 untouched.

- `SubmissionService.java`: rolling24h quota now counts immutable `queued` events for owned submissions rather than draft `created_at` or mutable `updated_at`. The event uses actual `clock_timestamp()` and is committed atomically with enqueue under existing user/admission locks. Cancellation and failure retain the admission charge; explicit retry needs a new admission; repeated finalize does not add a charge. Admission events older than24h leave the window regardless of later submission updates.
- `HttpGradingGateway.java`: explicitly selects HTTP/1.1, preventing HTTP2 h2c upgrade when sending multipart to Uvicorn. All strict header/package/provider/schema/response-size checks are preserved.
- `GradingIntegrationTest.java`: three regressions cover thirty25h-old drafts admitted today with mixed failure/cancellation, repeat finalize and explicit retry denial; normal29 admissions plus two concurrent finalizations produce exactly one30th admission and one429; old admission events expire independently of fresh submission timestamps.
- `HttpGradingGatewayTest.java`: verifies HTTP/1.1 and absence of Upgrade/HTTP2-Settings headers on authenticated multipart.

Final full Java21 run: **38 tests passed, zero failures/errors/skips**, including realPG17/Mailpit and privateGarage SDK test. Verified JUnit XML; `git diff --check` passed. GradingIntegrationTest now12 tests; other suite counts unchanged. One first-run expiry fixture omitted mandatory request_id; corrected fixture and reran the complete suite successfully.

Runtime owner was notified to rebuild backend and rerun `python3 scripts/integration/api-smoke.py` (optionally through same-origin `--base-url http://127.0.0.1:13000`). **Actual rebuilt backend→AI mock roundtrip and narrow independent rereview remain pending at this handoff**; HTTP unit tests alone do not close that gate. Runtime/source changes by other owners preserved. No paid calls, server changes or production approval.
