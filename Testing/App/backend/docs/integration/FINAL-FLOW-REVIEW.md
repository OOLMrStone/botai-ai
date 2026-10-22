# Final flow persistence review — PASS 2026-10-05

Read-only product-code review, resumed for a bounded race review. No product code, branches, services, credentials or live AI calls changed. Findings below are source-confirmed; isolated executable scenarios are described explicitly and are not browser test claims. Frontend owner and coordinator received actionable findings immediately.

## Final gate

PASS for the five concrete findings and their directly related race/ownership protections. No open blocker remains in this bounded persistence review. This is a source/hook/store gate, not a replacement for the separately owned browser/runtime/security gates.

Independent rerun: `node --test scripts/test-attempt-persistence.mjs` — 5/5 PASS; isolated erase-all regression — 1/1 PASS. Tests execute the actual hook/store modules with a controlled React lifecycle and API, covering observable retained inputs, transmitted PATCHes and accepted snapshots rather than only source patterns.

Three extra executable scenarios, injected into the same harness in memory without repository code edits, also PASS: stale same-revision polling cannot undo a post-mutation submission status; a detected remote revision conflict blocks PATCH while preserving original base/local answer; discarding one attempt preserves another attempt's answer and drawing draft. Combined run: 8/8 PASS (the five committed scenarios plus these three reviewer scenarios).

Source checks additionally confirmed account-state clears attempt sessions before cache/store reset; late ACK cannot repopulate an old owner's session; both route wrappers key the TrainingShell by attempt identity; ordinary retry and explicit discard are distinct actions with appropriate Russian labels. Mutation acknowledgements remove only the captured answer/array, preserving subsequent edits. Clean drawing hydration respects dirty/gesture state. Remote revision changes with local edits cause conflict instead of silently rebasing them.

## Actionable findings at review time

### P2 — Erasing the final drawing stroke is not persisted

- Front `src/stores/tasks-store.ts:239-246`: `commitDrawing` deletes `savedDrawings[taskId]` when the drawing becomes empty.
- Front `src/hooks/use-attempt.ts:84-86`: absent dirty drawing means no drawing PATCH.
- Reproduction: draw one stroke, wait for saved state, erase the complete stroke, leave/reload. The old server drawing returns; UI can incorrectly show saved state before reload.
- Minimal correction: retain `[]` as a pending drawing change until the successful PATCH acknowledgement removes it. Existing array handling in `persist` supports an empty array.
- Status: FIX VERIFIED after resume. `commitDrawing` now retains `[]`. Independently ran `node --test --test-name-pattern='полностью стёртый' scripts/test-work-3-behavior.mjs`: 1/1 PASS.

### P1 — Ordinary save-error retry discards pending input

- Front `src/components/tasks/TrainingShell.tsx:69-70`: the error retry action always calls `training.reload()`.
- Front `src/hooks/use-attempt.ts:151-156`: `reload()` clears answer drafts and resets the drawing store before fetching the saved attempt.
- Reproduction: go offline, edit an answer or drawing, wait for autosave failure, restore connectivity, click “Повторить”. The unsaved input is discarded and the old server version appears. If the retry GET fails too, local drafts have already been cleared.
- Minimal correction: transport-error retry must retain and save pending input. An explicit server-version reload for revision conflicts must clearly describe discarding local edits and only clear local state after a successful fetch.
- Status: FIX VERIFIED. Ordinary retry saves pending input; explicit discard fetches first and only then clears the selected attempt. Failed discard GET preserves local answers/drawings; actual hook regression PASS.

### P2 — Clean drawing cache ignores a newer server drawing

- Front `src/stores/tasks-store.ts:69-79`: hydration only inserts absent drawing keys, including when existing drawing has no pending edits.
- Reproduction: open attempt, return HOME, edit/save that same drawing on another device, resume original SPA. Latest attempt revision loads but old canvas remains; adding a stroke can overwrite the remote drawing without a revision conflict.
- Isolated executable test used the actual store module: hydrate `old`, then hydrate `remote-new`, output `{serverDrawing:"remote-new",renderedDrawing:"old",dirty:false}`.
- Correction must refresh clean items while protecting dirty and in-progress gestures; pointer-up is currently where drawing dirty state is committed.
- Status: FIX VERIFIED. Hydration updates clean items while preserving dirty and active-gesture drawings; actual store/hook regression PASS.

### P1 — Native SPA back loses unsaved answer drafts

- Front `src/hooks/use-attempt.ts:31,55-61,138-153`: answers live in hook refs; cleanup only disables acceptance. `beforeunload` does not protect client-side history navigation.
- Reproduction: enter an answer and use browser Back before the 700 ms autosave (or after save failure); Forward/resume fetches old server answer. The dedicated close button is safe, because it awaits save.
- Executable hook lifecycle harness ran the actual transpiled hook with controlled React lifecycle and API: answer `123` before unmount; blank answer after new mount.
- Status: FIX VERIFIED. Shared attempt drafts retain input across SPA unmount and reset on owner change; actual hook remount/owner-reset/late-ACK regression PASS.

### P2 — Late polling response rolls state back after successful navigation save

- Front `src/hooks/use-attempt.ts:36-48,128-140`: polling starts only when not working, but remains concurrent with a later mutation; `accept` accepts all arrivals.
- Deterministic actual-hook scenario: start old GET at revision 1/index 0; select sends PATCH and receives revision 2/index 1; resolve the old GET last. Hook returns revision 1/index 0. This reverses visible navigation and sets up a spurious subsequent 409.
- Correction: prevent superseded GETs from replacing later mutation state; avoid relying solely on revisions if submission status can change independently of attempt revision.
- Status: FIX VERIFIED. Fetch sequence and mutation generation reject superseded GETs. Actual hook delayed-GET regression and reviewer same-revision/status scenario PASS.

## Reviewed scope and evidence

- Read front `AGENTS.md`, relevant current/historical `SCOPE.md`, `docs/INTEGRATION-EVIDENCE.md`; backend frozen SPEC v1.5 and BACKEND-HANDOFF.
- Traced `use-attempt`, `use-attempt-route`, `use-training-shell`, TrainingExperience/TrainingShell and mock-exam wrapper, shared drawing hook/store, upload/feedback UI, SavedAttempts, learning API boundary, account-state, auth-store and cached resources.
- Shared real training/exam shell uses attempt item IDs for answers/drawings and canonical task IDs for favourites. HOME lists server unfinished attempts and uses exact attempt IDs; collection/exam labels remain distinct. No mock lesson fallback found in these entry paths.
- Cached resources use generation checks to reject late responses after owner invalidation; account change clears task/profile state and known legacy localStorage keys. This source trace does not establish complete runtime cross-account isolation.
- Upload path creates durable submission intent, sends actual File bytes, fetches updated revisions, and uses explicit retry/cancel endpoints. Grading polling fetches persisted attempt state. No live mathematical grading validation was performed.
- Existing integration evidence reports two collections plus an exam surviving reload/logout/login with answers, drawing, exact index, photo and unsupported result; these are frontend-owner browser results, not independently repeated here.

## Limits and separately owned gates

- All five findings are closed by the final source/race review. Legacy `MockExamTrainingShell` now has `key={examId}` as well as the primary wrapper's attempt key.
- The tests use a controlled lifecycle and transport. They do not establish browser engine behavior, real network cancellation or mathematical AI quality; dedicated frontend CUA and backend/runtime evidence remain authoritative for those gates.
- Frontend owner was already handling final CUA, asynchronous mock AI, admin/private media, profile and second-user isolation; consult updated INTEGRATION-EVIDENCE rather than duplicate broad QA.
- No broad security gate, backend test rerun, frontend build or new browser automation was run by this reviewer.

## Safe checkpoint

Only this report was created/updated. Product code stayed read-only. Bounded discovery and final fix verification are complete; no broad legacy/style rewrite is requested.
