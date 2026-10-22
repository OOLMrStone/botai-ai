# Active learning timer

Backend contract for the real attempt player. Migration `V10__activity_timer.sql` adds a persistent per-user session and an immutable event ledger; `V11__soft_delete_attempts.sql` supplies the attempt visibility predicate used here. Existing activity history and daily totals are retained.

## Endpoints

All endpoints require the existing authenticated, enabled `CurrentActor`. All POSTs use the existing session cookie and CSRF cookie/header protocol. Responses have `Cache-Control: no-store`.

- `GET /api/activity-timer`: current canonical state. Does not accrue seconds, grant a session, or renew a heartbeat.
- `POST /api/activity-timer/start`: `{ "eventId": "uuid", "attemptId": "uuid", "clientId": "uuid" }`. An owned, noncompleted, nondeleted attempt is required. Creates a fresh server-generated `sessionId`, fences the previous session, and establishes a zero-credit baseline.
- `POST /api/activity-timer/heartbeat`: `{ "eventId": "uuid", "sessionId": "uuid" }`.
- `POST /api/activity-timer/pause`: same body as heartbeat. Credits the final eligible interval and sets the session inactive. Resuming requires a new start. The current active owner may also close a newly completed, owned, nondeleted attempt; only time before its persisted `completed_at` is eligible.

`clientId` identifies a tab/player instance; it is diagnostic, not authorization. Only one timer session exists per user across all tabs and attempts. Starting another tab wins ownership without crediting its predecessor's unacknowledged interval. The previous tab must stop after `409 activity_session_stale`; it must not repeatedly start to fight for ownership.

The response `TimerState` is:

```json
{
  "sessionId": "uuid-or-null",
  "clientId": "uuid-or-null",
  "attemptId": "uuid-or-null",
  "active": true,
  "lastAcknowledgedAt": "server-instant-or-null",
  "serverNow": "server-instant",
  "heartbeatSeconds": 15,
  "maxGapSeconds": 45,
  "acceptedSeconds": 15,
  "dailyActiveSeconds": 75,
  "attemptActiveSeconds": 75,
  "stats": {
    "xp": 0,
    "streakDays": 0,
    "dailyGoalMinutes": 20,
    "dailyProgressMinutes": 1,
    "date": "2026-10-07",
    "timeZone": "Europe/Moscow",
    "week": [],
    "resumeAttempt": "uuid-or-null"
  }
}
```

`week` uses the existing seven-day stats shape. Before adoption, IDs/acknowledgement are null and active is false. `dailyActiveSeconds` includes existing legacy time. `attemptActiveSeconds` includes retained timer intervals plus existing legacy attempt events. These are durable totals, without an optimistic elapsed tail. `acceptedSeconds` is the increase in integer daily totals caused by this event; GET/start return zero. Replace totals with the response, never add `acceptedSeconds` to a client counter.

## Frontend lifecycle and trust boundary

1. Read the canonical state and stats after loading/reloading. The returned session is informational: start a fresh session when the current player is visible and focused. Never recover by submitting time accumulated offline.
2. Start only while the real attempt player is visible and focused. Send sequential heartbeats every 15 seconds while both conditions hold.
3. On `visibilitychange` to hidden, window blur, navigation, or player unmount, stop the heartbeat immediately and send pause immediately. Pause uses normal authenticated CSRF requests. Delivery may fail during page close; the next start discards that unacknowledged tail, and a 45-second gap also stops counting it.
4. On refocus/resume, start with a new event ID and fresh server session. Keep a lifecycle generation locally; responses to an older generation must not replace a newer session. A start response arriving after blur must be paused or ignored according to the serialized lifecycle rather than used to restart hidden heartbeats.
5. On `409 activity_session_stale`, stop the old session. On missing/completed/deleted attempt (`404`) from start/heartbeat, stop the timer and reconcile the attempt. After successful completion, send the final pause for the current session; it has the narrow completion exception described below. An explicit fresh user activation can start again if the attempt is still eligible.
6. After network ambiguity, retry the same event ID and exact body, or obtain a fresh GET for reconciliation. Do not issue simultaneous heartbeat/pause requests: the backend processes arrival order, not browser event timestamps. Never replay a late heartbeat after a blur as if the player were still active.

The server cannot prove visibility, focus, user attention, or genuine learning. A scripted authenticated client can send apparently valid heartbeats. The protocol provides reliable accounting for an honest frontend and prevents duplicate/overlapping tabs, client-supplied seconds, accidental hidden accumulation, and offline/backdated claims. It does not claim fraud-proof activity detection.

## Accounting and ordering

Every timer operation locks the enabled user's database row. Legacy activity uses the same user row lock. Server time is captured after serialization, including the event-ID lock; a UUID advisory transaction lock also serializes collisions between different owners without exposing another owner's response.

A heartbeat/pause credits the elapsed server interval since the last acknowledged tick only when the stored session is active and its session ID matches. At a gap of exactly 45 seconds the interval is eligible; a gap greater than 45 seconds credits **zero**, not 45 seconds. An expired heartbeat reanchors the current session with zero credit, allowing the next normal heartbeat to count. GET reports expired sessions inactive and performs no repair or lease renewal. Pause after an expired gap also credits zero. A paused session rejects fresh heartbeats/pause until start.

Backward server clock movement is clamped at the persisted acknowledgement; it cannot move the baseline backward or credit the same interval again. This is a persisted wall-clock accounting cursor, not a promise to remain accurate under arbitrary forward clock jumps. A jump beyond the maximum gap receives zero credit. No client timestamps or seconds are accepted. Production instants use microsecond precision to match PostgreSQL timestamps.

Accepted intervals split at each midnight in the profile's IANA timezone, including daylight-saving boundaries. `user_activity_days.timer_remainder_nanos` retains each day's fractional seconds; integer seconds remain compatible with existing stats, which floor each day's minutes. The timer ledger stores raw interval nanoseconds. Therefore the floored per-attempt total can differ from the sum of separately floored daily totals by less than one second per involved day. Repeated subsecond heartbeats do not discard precision.

Event IDs are globally unique. An event is bound to owner, operation, and the complete request. Exact retries return the **original response snapshot**, including original accepted seconds and server time, without checking or changing today's session/lease. Changing body/operation or reusing another owner's ID returns generic `409 activity_event_conflict`. A replay can consequently contain a superseded active session; use the local lifecycle guard and fresh GET for canonical reconciliation. UUIDs are idempotency keys, not credentials.

The state, credited day totals, and event snapshot commit atomically. Attempt identifiers in timer state/ledger intentionally have no attempt FK; deletion must retain time history. GET reports a missing/completed/deleted attempt inactive; start and heartbeat reject it, and pause rejects missing/deleted attempts. Historical exact retries still return their snapshots and never recreate an attempt. The sole completion exception is final pause for the current stored active session on its owned, nondeleted attempt: the credited interval ends at the persisted `completed_at`, and the session closes. Receipt-time gap still must be at most 45 seconds; a delayed pause cannot revive an old tail. Missing or future `completed_at` yields zero credit and closes safely; a timestamp before the last acknowledgement also yields zero. Start/heartbeat remain prohibited after completion and GET remains inactive. Deleted/foreign attempts have no exception. Existing completion timestamps are the backend authority; the timer does not invent client completion times.

## Legacy transition and progress

`POST /api/activity-events` remains compatible before a user's first successful timer start. After adoption, the persistent state row is a permanent marker: fresh legacy events receive `409 activity_timer_required`, even after pause/expiry/deletion. Exact historical legacy retries remain readable and add no time. Do not delete state to reset a session: doing so would reopen legacy credit.

Daily goal progress continues to use durable daily minutes. Time alone does not grant XP or qualify streak days; existing accepted real grading determines those independently. `ProfileService.stats(user, Instant)` keeps timer response dates consistent with the timer's server clock; the standalone stats endpoint retains its existing current-time behavior. Soft-deleted attempts are excluded from stats resume and legacy admission.

## Validation evidence

Verified on 2026-10-07: Java compilation passed; `ActivityTimerIntegrationTest` **13/13 passed** and existing `LearningIntegrationTest` **8/8 passed** together after the final precision and explicit-null serialization changes. Authenticated HTTP GET before adoption verifies that `sessionId`, `clientId`, `attemptId`, and `lastAcknowledgedAt` are present with JSON null, with HTTP 200 and no-store unchanged. Independent read-only security review found no blocking defect. The scoped run includes exact 45-second boundaries, microsecond canonicalization, frozen retries, stale tabs, pause/reload, expired/delayed pause, clock rollback, local midnight/fractional carry, goal/stats, legacy transition, deletion/completion/ownership, concurrent distinct heartbeats, cross-owner event collisions, and HTTP session/CSRF/cache/disabled-principal checks. Tests use an isolated Testcontainers PostgreSQL 17 instance, real Flyway migrations, a controlled timer clock, concurrent transactions, and real HTTP session/CSRF requests. They do not restart or rebuild the parent development/stage containers.

The run used the installed Java 21 toolchain at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` because the default local Java is 25. No commits, frontend edits, Docker configuration changes, parent container restart/build, or deployment were performed by this backend task. Frontend lifecycle integration and live development-service activation belong to the parent task.

Completion-tail follow-up: targeted `ActivityTimerIntegrationTest` **16/16 passed** after the pause-only exception, covering valid completion cutoff, frozen retry, expired completed pause, null/future/pre-anchor completion timestamps, and deleted rejection. Independent security rereview found no blocking issue. Existing profile/statistics code was unchanged by this narrow follow-up.
