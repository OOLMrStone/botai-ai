# Core backend checkpoint

2026-10-05; frozen SPEC v1.1. Core slice implemented; grading/media/admin remain separate ownership. Nothing deployed to production. No paid AI calls, secrets or production user data read.

- Auth baseline fast-forwarded to origin/feature/email-ops `0295e72`. V1–V4 byte-identical (`git diff origin/feature/email-ops -- <V1..V4>` empty). Additive V5 schema + V6 seed; PostgreSQL17 preserved.
- Catalog snapshot https://math-ege.sdamgia.ru/prob_catalog dated2026-10-05:140 topics across20 positions. 100 original synthetic fixtures,5 per number, explicitly isDemo; no source problem bank copied. Format preserves draft2027/FIPI source/max33. Exact20 exam enforced by database constraint trigger.
- Implemented catalog/task/favourites/daily task; training/exam start, immutable snapshots, history, owner-scoped draft optimistic revisions and checked-only solution; profile/onboarding/stats/activity events. Real progress is server-derived and excludes fixtures/mock results. Bounded heartbeat deduplicates events and caps elapsed time across attempts.
- Auth hardening:UTF8 BCrypt72-byte guard, bounded login fields, PostgreSQL account/IP rate windows, session+CSRF authentication strategy, current enabled/role check with stale-session revocation, current-role admin matcher, safe ProblemDetail code/requestId, profile field allowlist. Missing CSRF now403 per frozen SPEC; legacy auth error details preserved.
- Shared exact signatures/schema/ownership: [BACKEND-HANDOFF](BACKEND-HANDOFF.md). Two real ports (GradingGateway/ObjectStorage); capabilities fail closed if adapter unavailable. Runtime uses SESSION_COOKIE_SECURE override. No public plan/role mutation or demo account backdoor.

## Verification

Executed inside eclipse-temurin:21-jdk, unchanged target21, Docker Testcontainers PostgreSQL17 and Mailpit:

`./gradlew test --tests '*AuthFlowIntegrationTest' --tests '*UpgradeIntegrationTest' --tests '*LearningIntegrationTest' --no-daemon`

Result: **16 tests passed** (Auth7, Upgrade1, Learning8), exit0; Java compile passed; git diff --check clean. JUnit XML under build/test-results/test. Tests cover auth/password/OTP/reset/email verification, CSRF rotation/denial, Unicode limit, plan elevation400/adminUSER403, full taxonomy/exam, per-user identity, shortage/idempotency/concurrent start, draft conflicts, favourites, snapshot survival after catalog edit, immutable content/membership, demo progress exclusion and bounded replay-safe activity.

V4 upgrade test inserts local+OAuth users and a session before migration, then verifies original hash/created_at/email_verified/provider and session survive; original Flyway checksums unchanged. This is schema upgrade verification, not a production backup/restore rehearsal.

## Remaining integration verification

Worker/media/admin acceptance, private S3 handling, complete request-body/rate/retention cleanup, frontend browser flows, isolated staging, operational backup/restore and production cookie/ingress checks belong to subsequent slices. Core tests intentionally do not claim those checks. Runtime should provision development-only accounts explicitly and provide a safe SMTP sink; no accounts/roles are seeded in V5/V6.
