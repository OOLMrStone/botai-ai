# Frontend recovery — 2026-10-05

Status: recovered baseline READY for semantic integration; no backend integration claimed.

## Authority and location
- Main checkout `/Users/vasiliyslobozhanov/projects/botai/botai-front`, branch `develop`; HEAD remains `c74f8cd` with recovered working changes.
- Latest Storefront («большой сайт», `01a0ede8-8295-7330-bdd7-d480151db3c5`) is primary: public root + complete learning app, desktop/sidebar, latest marketing copy/prices/assets, auth-aware entry.
- Work3 is supporting source only: Storefront already synchronized Onest/brand/control geometry/training setup. No Work3 overwrite of Storefront.
- Original stashes unchanged; never pop/drop. Private refs `refs/recovery/2026-10-05/{work3,storefront,develop,availability,integration}` pin all five originals.
- Archival baseline snapshot `refs/recovery/2026-10-05/approved-baseline` = `3fff0f53a43905c13ed66a9bbfac3e02428d4ac8`. Created with private temporary index; main branch/index untouched.
- Backup root: `/Users/vasiliyslobozhanov/.codex/backups/botai-front-recovery-2026-10-05` (B below).
- B has per-stash full path/blob manifests, bounded extracted originals, ignored SCOPE/skills snapshots, tracked binary patch, exact `provenance.json`, checks and screenshots.
- Unfinished integration `c7c1573e94da31f3796ce7eeb5460dc430fd1657` remains unapplied; original backup `/Users/vasiliyslobozhanov/.codex/backups/botai-front-integration-2026-10-05/HANDOFF.md` preserved.

## Sources and resolutions
- Storefront tracked tree + third-parent untracked files restored together. Deleted old app routes are intentional moves into `src/app/(learning)/...`, preserving public URLs.
- Root `src/app/page.tsx`, storefront components/config/hooks/store, marketing assets, app layout/navigation, learning routes/primitives come from Storefront.
- Missing Work3 design-system skill/supporting docs restored; latest ignored Storefront SCOPE/skills recovered from existing sibling. AGENTS read and unchanged.
- Develop latest mascot videos/posters/config/source/player/hooks/render tests preserved. `/lemur-*` preview routes live inside `(learning)`.
- Storefront-only old LemurWalk/LemurWalkPreview replaced by develop shared LemurPreview/LemurVideo, keeping `/lemur-walk`; other Storefront marketing artwork retained.
- `layout.ts`: Storefront throughout; add only develop mascot surface/buffer/reaction roles, using semantic rounded-tile. No old develop layout overwrite.
- `client.ts`: availability bounded timeout + caller abort + checked CSRF bootstrap, retaining Storefront abort-aware `sleep`; constants merge retains Storefront keyboard viewport config.
- Auth: Storefront revision/race guard retained; availability error state and shared retry UI merged into AppGuard/settings/training/setup/mock-training. Storefront landing/learn entry hooks retained.
- `next.config.ts`: Storefront rewrites/dev origins plus availability standalone output and unoptimized local images; no dependencies changed.
- Availability old deployment manifests/root routing omitted: current runtime executor owns final deployment; latest Storefront owns root.
- Drawing test fixture updated to Storefront canonical `coordinateSpace: width`, y=0.1 rather than legacy workspace y=100. All assertions retained; existing migration/rotation tests retained.
- Historical research screenshots/frames and extension CRX are preserved in original stash/ref, not copied to main. No 10k artifact import. Non-runtime source research remains retrievable via full manifests.
- SCOPE begins with recovery/integration status; old mock functionality is explicitly marked as not yet integrated.

## Verification
- `npm run lint`: ESLint + all 76 design/brand/typography/Work3 behavior tests PASS (`lint-final.log`).
- `npm run build`: production build PASS, including standalone output; all recovered routes listed (`build.log`).
- `npx tsc --noEmit` PASS. Initial generated .next type errors referenced pre-move paths; old generated cache archived at B/next-cache-before and regenerated.
- `node --test scripts/test-api-client.mjs scripts/test-auth-store.mjs scripts/test-task-drawing.mjs`: 42/42 PASS (`behavior-final.log`).
- `git diff --check` PASS. Branch verified develop, original stash list unchanged.
- Extra animation source QA: 74/79 pass; 5 require intentionally un-restored archived source fixtures/frames (hang-volume, rejected joy v3, paywall source-v5, sit rejected poster/exported frames). Not runtime failures; detailed `lemur-tests.log`. Source QA not claimed complete.
- CUA live mock preview: root mobile375 → primary CTA → onboarding/welcome; Onest/brand visible; no horizontal overflow.
- Test account login → /home; desktop1440 cabinet/sidebar and root show `Тест Тестов`, root name link → /home.
- Desktop catalog → training/setup; mobile320 setup → training; numeric answer → next task; desktop1440 workspace, footer actions48px, no horizontal overflow.
- `/lemur-walk` mobile430: source video loaded readyState4, active playback observed with changing pose/time; no media error.
- Console warning/error log empty for checked paths. Screenshots at B: storefront-mobile.png, storefront-desktop.png, onboarding-mobile.png, catalog-desktop.png, training-setup-mobile.png, training-mobile.png, training-desktop.png, bo-walk-mobile.png.
- Full dark-mode/OS high-contrast, all mascot interactions and backend browser flow not verified in recovery; integration QA must cover final whole app.

## Handoff to frontend_integration
- Recovery complete; safe to edit main develop now. Read restored AGENTS, SCOPE, `.claude/skills/*` and SPEC FROZEN v1.3.
- Reapply integration checkpoint semantically against `(learning)` paths and rich Storefront UI. Preserve root/learn/username and desktop/mobile layout; no stale root-route overwrite.
- Required commands: lint (includes design guards), tsc, production build, meaningful auth/API/drawing tests + final connected browser QA. Fix violations, do not relax guards.
- Baseline still uses original mocks/19-number catalog/demo scoring. Integration must implement SPEC20 taxonomy, real bytes/auth/profile/history/ownership; recovery does not certify these.
- Guard tests include historical mocked behavior; update assertions only for legitimate contract migration, preserving independent geometry/brand/typography invariants.
- Temporary mock dev server `http://127.0.0.1:3000`, exec session26012 remains running; stop/restart it when connecting real backend. No external publication or paid calls.
