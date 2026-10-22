# BotAI integration contract

Status: FROZEN v1.6, 2026-10-05. Implemented contract; current verification and remaining browser gate: [RESUME](RESUME.md), [runtime](RUNTIME-EVIDENCE.md), [security](SECURITY-CODE-REVIEW.md). Implementers must read this file; API changes require coordinator + affected implementer agreement. Design evidence: [front](frontend-flow.md), [data](data-architecture.md), [security](security-review.md). Contract changes must be announced to affected implementers.

## Scope and product decisions

- User update: main frontend develop must become the latest unified Storefront from chat «большой сайт» (showcase + actual product), recovered from preserved2026-10-02 stash, then receive this integration. Storefront is the primary target; Work3 is a supporting design source, not an override. Preserve useful current develop changes/assets. Preserve mobile and desktop learning layouts, root landing and authenticated/new-user entry routing. Final running stack includes the large site. Stash recovery must retain all original snapshots and current integration work; see WORKLOG hashes.

- Separate front (Next), back (Spring/PostgreSQL), AI (FastAPI). Preserve existing auth/session/email verification; reconcile origin/feature/email-ops V1–V4 before V5+. Quizzes remain mocks and cannot award server progress.
- Real-API onboarding must bypass the preexisting unfinished `/lesson` and decorative streak screen: ready → existing registration/save-progress → registration/login → await persisted onboarding → real HOME. Already authenticated users use the existing persistence/entry path without a registration loop. Explicit mock mode may retain those demonstration screens. v1.6 changes UI routing only; no new guest API or fake progress.
- Product format `ege-profile-20-v1`: 20 positions using the current [catalog](https://math-ege.sdamgia.ru/prob_catalog); all source topics seeded with stable IDs/source links. Explicitly labelled original synthetic task fixtures across all positions; no claim to import the site's entire task bank.
- Numbers: 1 planimetry, 2 vectors, 3 solid geometry, 4 basic probability, 5 compound probability, 6 statistics, 7 equations, 8 transformations, 9 derivative, 10 applied problems, 11 word problems, 12 function graphs, 13 financial math; extended 14 equations, 15 solid geometry, 16 inequalities, 17 economy, 18 planimetry, 19 parameters, 20 numbers.
- AI routing prepared for every extended position. Existing approved #16 pipeline only; other packages remain unimplemented by explicit user decision. Missing capability is `unsupported`, never a fake grade. Adding an approved AI capability must not require frontend/backend special-case code.
- Mock AI outputs explicitly marked demonstration; they verify plumbing, not mathematical quality. No paid provider calls in tests. Original provider settings and approved prompts preserved.
- Official draft2027 maxima: 1–13=1; 14=2,15=3,16=2,17=2,18=3,19=4,20=4, total33; [FIPI source](https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/ma_11_2027.zip), specification §10. Persist draft/source/version.
- Score = earned primary points / maximum. No invented 100-point conversion. Partial, rejected, failed, unsupported and unanswered remain distinct. A task is solved only at full points.
- Registered date = existing users.created_at. Preparation level, plan are lookup relations; favourites/solved tasks are per-user relations, not global task booleans or user arrays.
- Default timezone Europe/Moscow. One day with an accepted graded submission qualifies for streak, even if score is zero; quizzes, uploads, errors, synthetic tasks and mock-provider results do not. Store activity days and server streak projection. Training minutes use the server-clock activity timer; the bounded legacy activity endpoint remains available only before timer adoption. See [ACTIVITY-TIMER](ACTIVITY-TIMER.md).

## Home: saved collections (user update)

- Authenticated home replaces the daily-task card with all unfinished training collections and exam attempts, newest exited first (creation time before the first exit). Public Storefront remains the approved landing page.
- Collection = persisted Attempt, not a temporary client selection: stable ID, owner, immutable ordered task versions, saved answers/drawings/photos, per-item results and currentIndex. Multiple unfinished collections coexist.
- Each card shows type/title, checked/total progress, pending status and exact resume action. Reload, logout/login or another device restore that exact attempt. Never route to mock lesson or create a replacement attempt on resume. Empty list has honest empty state + catalog action, no misleading Continue.
- Both training and exam are Attempt entities. HOME explicitly distinguishes «Продолжить подборку №16» (multiple numbers listed when selected) from «Продолжить пробник» with its title; never an ambiguous generic resume label. This v1.5 clarification changes UI wording only, not schema/API.
- GET `/api/attempts?status=unfinished` filters active/checking and excludes soft-deleted attempts. All history lists order by `coalesce(lastExitedAt,createdAt) DESC,id DESC`, with bounded pagination; autosave and rename do not reorder the list. Failed/rejected/unsupported or missing-input items keep unfinished attempts resumable; only fully graded attempts complete automatically. Existing `stats.resumeAttempt` remains compatibility data ordered by `updatedAt`, but home does not substitute one UUID for the list.
- Browser acceptance: two distinct collections + exam, partially answer/upload/check, leave/relogin/reload, resume each with matching progress/draft/index; new user has no Continue fallback.
- Delivery includes actual DB schema guide/ER diagram and protected browsing access, with private media metadata distinguished from S3 bytes.

## Boundaries and invariants

- Browser uses same-origin `/api`, current apiFetch, SESSION+CSRF. Backend derives user from session; client cannot set user/role/plan/score/streak/answer key/provider/S3 key. No secrets in NEXT_PUBLIC.
- Feature-first backend: catalog, attempt, grading, media, profile. Controller → application service → repository; external ports ObjectStorage and GradingGateway. Worker HTTP outside DB transactions. No new broker/Redis.
- UUIDs are strings in public JSON; timestamps ISO8601 UTC. Task ID is canonical; taskVersionId immutable; attemptItemId identifies a specific occurrence. Draft revisions are optimistic locks. All object reads/mutations scoped by owner; ADMIN separately checked against current enabled user.
- Public Task DTO excludes accepted answers/reference solution. Reference is revealed only by the checked-item result endpoint. Published task content and attempt membership remain immutable.
- Exam template contains exactly 20 positions. Creating an attempt atomically snapshots task versions/order; new attempt starts empty. History is never replaced by a later attempt.
- `isFavourite` is a per-user projection. Favourite from an exam resolves through the same task catalog. No migration of browser mock scores into real progress; clear/isolate old user-global localStorage and caches on logout/account switch.
- Errors preserve Spring ProblemDetail `{type,title,status,detail,code,requestId,fieldErrors?}` with bounded safe text; frontend adapter reads detail and existing auth errors compatibly. 400 validation, 401 session, 403 permission/CSRF, 404 missing or foreign object, 409 revision/idempotency/availability conflict, 413 bytes, 422 unsupported/unprocessable, 429 limits, 503 dependency unavailable. No raw upstream errors.

## Public API (camelCase)

| Route | Contract |
|---|---|
| GET `/api/catalog` | `{format,numbers}`; format `{id,version,title,totalTasks,maxPoints}`; number `{examNumber,part,title,responseType,maxPoints,gradingCapability,availableCount,topics}`; topic `{id,title,availableCount,sourceUrl}` |
| GET `/api/tasks` | Optional examNumber/topicId/difficulty/favourite filter; bounded cursor pagination `{items,nextCursor}` |
| GET `/api/tasks/{taskId}` | Task |
| GET `/api/favorites` | Same paginated Task shape, canonical task IDs |
| PUT / DELETE `/api/favorites/{taskId}` | Idempotent add/remove, `{taskId,isFavourite}` |
| POST `/api/training-attempts` | Idempotency-Key; `{formatId,selections:[{examNumber,topicIds?,count}],difficulty?:1..5,difficultyPreference?:0..100,source?,taskIds?}` → Attempt; 1–20 per number, ≤50 total; no duplicate selections or silent shortage |
| GET `/api/mock-exams` | `{items,nextCursor}` of `{id,title,createdAt,totalTasks,maxPoints,isDemo,latestAttempt?,activeAttemptId?}` |
| POST `/api/mock-exams/{templateId}/attempts` | Idempotency-Key → new Attempt; repeat same key returns same attempt |
| GET `/api/attempts` | Visible owner history; bounded pagination, optional kind/templateId/status=unfinished; `coalesce(lastExitedAt,createdAt) DESC,id DESC` |
| GET `/api/attempts/{id}` | Attempt, including persisted drafts/status/results |
| PATCH `/api/attempts/{id}` | `{revision,currentIndex?,items?:[{id,answer?,drawing?}],title?:string}` → Attempt; conflict 409; no edits to queued/graded input; title is trimmed, 1–80 characters, explicit null/blank/non-string rejected; omitted title preserves the saved name |
| DELETE `/api/attempts/{id}` | Owner + CSRF; idempotent soft deletion, 204; retains draft, grades, activity, media and immutable history while hiding user-facing attempt access |
| POST `/api/attempts/{id}/exit` | Owner + CSRF; `{eventId:UUID}` → 204; records server exit time independently of draft revision/updatedAt; exact retry preserves time, reuse for another attempt returns 409 `exit_event_conflict`; deleted/foreign/missing attempts return 404 |
| POST `/api/submissions` | Idempotency-Key; `{attemptId,attemptItemId,inputRevision,retryOfId?}` → Submission intent, committed before upload validation |
| POST `/api/submissions/{id}/images` | Multipart `file`; normalized private image → Attachment; max4; durable validation event on failure |
| DELETE `/api/submissions/{id}/images/{imageId}` | Draft only; owner check and deletion event |
| POST `/api/submissions/{id}/client-rejection` | `{expectedRevision,reason}`; enum `file_type|file_size|image_count|image_dimensions|decode_failed`; recorded as untrusted client report, draft only, no raw bytes |
| POST `/api/submissions/{id}/finalize` | `{expectedRevision}`; freeze inputs, validate capability/limits, enqueue exactly once → Submission; unsupported terminal result stored without AI call |
| GET `/api/attempts/{id}/items/{itemId}/solution` | Owner + graded checked input only → `{referenceAnswer,referenceSolution}`; no reveal for rejected/failed/unsupported |
| GET `/api/submissions/{id}` | Submission with current terminal result; owner only |
| POST `/api/attempts/{id}/checks` | Idempotency-Key; `{revision,itemIds?}` → Attempt; server validates short answers and finalizes ready photo submissions; repeated call never duplicates AI dispatch |
| POST `/api/submissions/{id}/cancel` | Conditional cancel; history retained; late result cannot award progress |
| GET `/api/media/{id}` | Owner/admin image stream; private/no-store/nosniff |
| GET / PATCH `/api/profile` | Profile; editable displayName/goalId/levelId/dailyGoalMinutes/notificationsEnabled only |
| PATCH `/api/onboarding` | Await profile persistence before frontend resets onboarding state |
| POST / DELETE `/api/profile/avatar` | Multipart `file` / remove; S3 reference stored, stable authenticated avatarUrl returned |
| GET `/api/stats` | `{xp,streakDays,dailyGoalMinutes,dailyProgressMinutes,date,timeZone,week,resumeAttempt?}` |
| POST `/api/activity-events` | Legacy `{id,attemptId,seconds}`; ≤60 seconds/event, replay dedupe and elapsed-time cap; fresh events return 409 `activity_timer_required` after first timer start, historical retries remain readable |
| GET `/api/activity-timer` | Canonical `TimerState`, no credit/lease renewal; authenticated enabled actor, no-store |
| POST `/api/activity-timer/start` | Owner + CSRF; `{eventId,attemptId,clientId}` → fresh server session, zero-credit baseline; owned visible unfinished attempt required |
| POST `/api/activity-timer/heartbeat` | Owner + CSRF; `{eventId,sessionId}` → server-clock credit; 15-second cadence, gap over 45 seconds credits zero |
| POST `/api/activity-timer/pause` | Owner + CSRF; `{eventId,sessionId}` → final eligible credit and inactive session; completion-tail exception and exact-retry rules in [ACTIVITY-TIMER](ACTIVITY-TIMER.md) |
| GET `/api/daily-task` | Task selected by server, no reference in initial DTO |
| GET `/api/daily-task/solution` | Reveal today’s task reference on explicit action; never awards progress |
| GET `/api/admin/submissions` | Current ADMIN; bounded status/user/date filters and pagination |
| GET `/api/admin/submissions/{id}` | ADMIN detail: owner metadata, events, images, exact validated AI result; access audited |

Auth existing routes preserved. Public tariff changes/OAuth demo identities cannot grant actual access. Local-only demo setup seeds users through an explicit development mechanism; production has no hardcoded login.

## Shared DTOs

- Frozen enums: `gradingCapability=available|unsupported|unavailable`; `Attempt.status=active|checking|completed`; `Task.progressStatus=unstarted|in-progress|solved`; `Stats.week=[{date,qualified,minutes}]`. Capability unavailable means dependency/registry unavailable, unsupported means no approved handler.

- Task: `{id,taskVersionId,version,examNumber,part,topicIds,difficulty:1..5|null,isGrob:boolean,responseType:'short'|'photo',maxPoints,content:TaskBlock[],isFavourite,progressStatus,gradingCapability,isDemo,sourceYear}`. Existing TaskBlock text/latex/image representation retained. Image URLs server-controlled.
- Attempt: `{id,kind:'training'|'mock-exam',templateId?,formatId,status,revision,currentIndex,createdAt,updatedAt,completedAt?,items,summary,title?,lastExitedAt?}`; title is an optional user name, absent for attempts that retain their generated frontend name. Renaming uses the same owner check, row lock and revision as draft edits; history and direct reads return the saved name. `lastExitedAt` is absent before first accepted exit. Item `{id,task,answer,drawing,answerRevision,submission?,result?}`. Summary `{total,answered,graded,earnedPoints,maxPoints,pending,unsupported}`; incomplete scoring labelled.
- Attachment: `{id,fileName,mimeType,sizeBytes,status,previewUrl}`. Filenames bounded metadata only; keys server-generated. Actual File bytes uploaded immediately, not discarded after name extraction.
- Submission: `{id,attemptId,attemptItemId,inputRevision,revision,status,images,createdAt,updatedAt,result?,errorCode?,retryable,isDemo}`. Status `draft|queued|running|graded|rejected|failed|cancelled|expired|unsupported`.
- Retryable photo submissions include `expired` (an abandoned draft after 24 hours), `failed`, `rejected`, `cancelled` and `unsupported`. Retrying creates a new draft tied to the same attempt item and its current answer revision, with a new idempotency key and `retryOfId`; existing photographs, results and drawings are preserved. The new draft starts with no attachments and accepts a fresh upload before finalization. Attempt and submission responses expose the same retry policy.
- Result: `{isGraded,score:null|number,maxScore,feedback?,rejectionReason?,isDemo}`. Feedback is typed projection of validated OCR/analysis/grading, excludes raw AI task/ethalon and transport internals. Exact AI JSON is storage/admin only; reference reveal uses explicit endpoint. Failure/reject/unsupported has score null.
- Profile: `{id,email,displayName,registeredAt,avatarUrl?,goalId,levelId,dailyGoalMinutes,timeZone,notificationsEnabled,plan,features}`. Existing UserResponse mapping may add these fields without leaking auth internals. Front goal/level codes retained from onboarding config.

## Upload and asynchronous checking

1. First photo selection creates idempotent durable submission intent before sending bytes. Preflight errors are reported through a bounded intent rejection operation; backend repeats all authoritative checks. Unsent browser events cannot be guaranteed in server history.
2. Backend bounds request bytes, sniffs/decode/re-encodes static images, strips EXIF; solution accepts JPEG/PNG/WebP, ≤8MiB, ≤20MP, dimension≤8192, ≤4 images. Avatar stricter. Unsupported/corrupt/oversize input saves reason/metadata, never dangerous raw bytes. Disconnected uploads expire visibly. Reserve file slots atomically (staged+ready≤4), upload outside transaction, READY commit rechecks draft/revision. Finalize requires matching revision and no staged uploads; upload/delete increments revision.
3. Store normalized image in private S3 using official SDK, immutable generated key; DB metadata staged→ready. Orphan cleanup/reconciliation, no public ACL. AI gets bytes, not URLs/S3 credentials. Storage failures retain intent/error.
4. Finalize commits snapshot+event+queue atomically. Postgres worker claims with SKIP LOCKED, bounded concurrency, lease/fencing. Commit dispatch record before HTTP with CAS on claimed state, fencing token and unexpired lease; failed CAS forbids HTTP dispatch. No transaction held while waiting ≤360s AI deadline.
5. No automatic retry after uncertain dispatch/timeout/crash. Explicit retry creates a new submission with owner/item-checked retryOfId linked to a terminal failed/rejected/cancelled/expired/unsupported predecessor; terminal history is immutable. Polling/reload restore queued/running state. Browser close does not cancel.
6. Backend validates AI contract, task/image IDs, score bounds and graded/null consistency before accepting. Each AI response must carry checked provider mode and package ID; store with run, never infer mode solely from cached capabilities. Atomic result/event/progress update; stale workers cannot overwrite cancellation/result or award twice.
7. Every accepted intent has lifecycle events: validation failures, unsupported, uploads, dispatch, rejection/attack, timeout and final response. Early proxy/auth/CSRF failures have security logs; never claim the DB records requests it did not receive. Admin can inspect structured text and private photos safely.

## AI boundary

Exact internal contract follows [ai-contract.md](ai-contract.md); Adapter response≤1MiB before parse, total HTTP deadline≤390s, redirects/retries disabled; mandatory per-response X-Grading-Provider-Mode and X-Grading-Package-Id checked against pinned capability. Service token fail-closed, route excluded from public ingress, no browser cookies or user PII. Registry covers14..20; #16 reuses approved Session/tools/validator, prepared server task bypasses task-image OCR only. Standalone service remains compatible. Capability response drives availability; no frontend per-number AI branches.

## Runtime and delivery gates

- PostgreSQL17, private S3-compatible local service, AI mock, backend, frontend proxy; Adminer loopback only. See runtime-plan.md for pinned images, paths and rollback. Dependencies outside existing frontend stack are unnecessary.
- Preserve V1–V4 checksums, auth users/sessions/email state. New migrations V5+. Test V4 upgrade with fixtures and backup restore before production changes. No down -v, Flyway repair or destructive schema replacement.
- This application requires schema through V12: V8 numeric difficulty, V9 attempt titles, V10 activity timer, V11 soft deletion, V12 exit recency. Soft deletion retains original attempts/items and results; creation-key replay returns 404 instead of restoring a deleted attempt. User-facing submissions, solution/media access, catalog in-progress status, exam links and stats resume exclude deleted attempts; administrative history remains available.
- Public upgrades use the packaged one-shot `org.botai.back.migration.MigrateOnly` entrypoint through Boot `PropertiesLauncher`, with only dedicated `APP_MIGRATION_JDBC_URL`, `APP_MIGRATION_USER`, `APP_MIGRATION_PASSWORD`. It requires existing public V4+ history, validates checksums, migrates through V12 and exits without a Spring context, HTTP listeners or workers. Missing/invalid configuration, checksum/schema mismatch or incomplete migration fails closed; no baseline, repair or clean is allowed. Keep migration credentials out of the long-lived backend; runtime backup, production-copy rehearsal and grants remain separate deployment gates.
- Tests: auth/CSRF; two-user ownership; all20 taxonomy and exact20 exam; counts/shortage; reload/history/favourites; private S3 avatar/photo; invalid uploads persisted; repeated finalize; worker race/crash; AI timeout/malformed/wrong IDs/no score; role/admin; no mock success in real mode.
- Front lint/typecheck/build + browser QA small/large viewport: registration/login, multi-number selection, short check, real photo bytes→mock AI16, unsupported14..20, attempt reload, history, favourites, avatar/profile and admin. Quizzes unchanged.
- Separate isolated server mock smoke before replacing any live route. Preserve provider env, develop/gateway isolation and production rollback. Report separately what is tested locally, on server, and not verified with a paid model.


### Numeric task difficulty and training preference (V8)

`Task.difficulty` is an integer 1 through 5 or explicit `null` (unknown). `isGrob` is true exactly at level 5 and false for null; PostgreSQL derives it from `task_versions.difficulty_level`. Legacy `difficulty` labels remain unchanged on historical versions and do not imply a numeric level. Rating corrections publish new immutable versions; attempts retain pinned snapshots. `GET /api/tasks?difficulty=5` is an exact numeric filter.

`TrainingRequest.difficulty` is an optional exact numeric filter; `difficultyPreference` is an optional integer 0..100. The front end sends the slider value directly. At 0 only level 1 is eligible; at 100 only levels 4/5 are eligible. Interior positions admit unknown tasks only after all eligible rated tasks have been selected. Unknown ratings are never converted to 3. Explicit task IDs still obey strict endpoints and any exact filter. Insufficient eligible tasks return 409 `insufficient_tasks`; counts are not silently reduced.

Category weights at slider anchors are `[1,0,0,0,0]`, `[.05,.45,.45,.04,.01]`, `[0,0,0,.7,.3]` at 0/50/100. Each half uses smoothstep interpolation; weights are renormalized across nonempty rated categories. Selection is without replacement, with unsolved tasks preferred within the chosen category. Deterministic request-key seeding supports repeatable selection; persisted attempt idempotency remains authoritative. Topic/favorite/archive filters apply before selection. Frontend availability counts use the complete fetched task pool and these exact eligibility rules.
