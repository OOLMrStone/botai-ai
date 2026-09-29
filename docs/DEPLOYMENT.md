# Selectel test deployment

Updated and deployed 27 September 2026. The service is on Selectel at `135.106.182.11`, with sources and its private environment file under `/srv/ege/app`. The updated `ege-grading-api` container is healthy on loopback port 8080. Existing authentication and database services were preserved; the `.env` hash is unchanged.

The user-facing form is [https://api.botai-ege.ru/internal/grading/](https://api.botai-ege.ru/internal/grading/). The domain root intentionally returns 404. The existing host Caddy maps the form to the application's `/ui/` and protects access. `/api/v1/*` accepts the existing tester Basic authentication or application session authentication. The form calls `/internal/grading/api/photo-check` (including `/config`), which Caddy protects with the same tester login and rewrites to `/api/v1/photo-check`. Keep this handler before the generic UI handler: browser Basic credentials are scoped to the page directory and are not reliably reused for the disjoint `/api/v1/` path. The sanitized host reference is `deploy/caddy-host.Caddyfile`.

```text
HTTPS → host Caddy → 127.0.0.1:8080 → ege-grading-api:8000
                                └─ /srv/ege/app/deploy/docker-compose.prod.yml
```

Keep the application port bound to loopback. Do not publish it on all interfaces or add a second TLS proxy.

## Historical deployment — 27 September 2026

At that deployment, the image was `ege-grading:photo-20260927`, also tagged `ege-grading:latest`. The previous image is retained as `ege-grading:before-photo-20260927`. A source rollback snapshot, excluding `.env`, is stored at `/srv/ege/backups/app-before-photo-20260927.tar.gz`.

Offline verification passed locally and on the Linux server: 351 tests passed, 3 skipped. The server tests and a complete five-image mock request in the production image ran with networking disabled. Direct application health and configuration return successfully; the configured model was preserved. Authenticated external requests to `/internal/grading/` and `/internal/grading/api/photo-check/config` both returned 200 with the new form and preserved model configuration. The public form requires the existing tester login and returns 401 without credentials. Those deployment checks made no paid model calls. Subsequent saved model evals are documented in [task 16](../tasks/16/README.md).

A temporary SSH forward can expose the form locally (for example, `http://127.0.0.1:8766/ui/`). Such an address works only while its SSH connection remains active; the permanent address is the protected HTTPS form above. Authentication credentials are not stored in this documentation.

## Access and private configuration

An existing local SSH key permits this connection:

```bash
ssh -i ~/.ssh/botai root@135.106.182.11
```

The local `ege-server` SSH alias is configured in `~/.ssh/config`; a private access note is stored outside Git in `~/.config/botai/server-access.md`. Site passwords and API keys must not be copied into documentation or chat. Keep the server's `.env` private and preserve it during deployments.

The inspected model configuration points at `https://api.deepseek.com` with `LLM_MODEL=deepseek-v4-flash` and an API key present. Both stages of the new `/api/v1/photo-check` workflow use the `LLM_*` settings. Existing `LLM_VISION_*` settings apply to the legacy pipeline only.

The model name is retained as configured. DeepSeek's [official updates](https://api-docs.deepseek.com/updates/) describe alias changes; a configured alias may be redirected by the provider. Do not run paid readiness probes for routine infrastructure checks. The single authorized live grading check on 29 September is recorded below; broader model-quality results are documented separately.

## Persistent storage

| Host path | Container path | Purpose |
| --- | --- | --- |
| `/srv/ege/reports` | `/data/reports` | Existing legacy reports; preserve them |
| `/srv/ege/suspicious-submissions` | `/data/suspicious-submissions` | New private attack reports, associated solution images and identity signer |

Before starting the updated non-root container, create the new directory with the correct owner and permissions:

```bash
install -d -m 700 -o 10001 -g 10001 /srv/ege/suspicious-submissions
```

`PHOTO_REPORTS_DIR=/data/suspicious-submissions` is set in the deployment Compose file. The service creates `.identity-secret` there to sign local test-user cookies; retain it across container replacements. It is not a real application user identity.

Reports contain the test user ID, solution-image IDs and a creation timestamp. The associated images remain private. Cleanup removes expired reports and their images after 30 days, on startup and during service operation. Do not expose this directory through Caddy. Do not prune unrelated legacy reports or main-application data.

## Safe update procedure

1. Record the current container image and Compose settings and take a private rollback snapshot of the existing application files. Preserve `.env`, legacy reports and new private storage.
2. Build the candidate image separately. The build assembles `tasks/common/prompts/` as runtime `prompts/common/` and `tasks/16/prompts/` as runtime `prompts/16/`; editorial history, hypotheses and hidden evaluation answers do not belong in the production package.
3. Run the candidate on a separate loopback port with `LLM_PROVIDER=mock` and `LLM_VISION_PROVIDER=mock`. Verify the form, `/api/v1/photo-check/config`, multipart upload, validated result and offline tests before replacing the current container. Use isolated candidate storage for these checks.
4. Install the reviewed sources without overwriting the server's `.env`. Rebuild and recreate the service using the deployment Compose file:

```bash
cd /srv/ege/app/deploy
docker compose -f docker-compose.prod.yml up -d --build --force-recreate grading-api
```

5. Check direct application health, configuration and the authenticated public form without submitting a paid grading request. If startup fails, restore the recorded prior image and source snapshot and recreate the previous service, keeping persistent data intact.

Prompt changes require an image rebuild. Environment changes require recreation; `docker compose restart` does not load new values from `.env`. The local development stack mounts prompt files for editing, but the deployed image contains its own fixed copy.

## Checks and operations

```bash
cd /srv/ege/app/deploy
docker compose -f docker-compose.prod.yml ps
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/api/v1/photo-check/config
```

The public `/health` is a constant response from Caddy. It confirms proxy reachability, not that the application or model works. The container healthcheck calls the application directly and does not call a model. Do not request `/health/ready?probe=true` for deployment verification: it can spend API balance.

The new form sends one `task_image` and up to four `solution_images`, each up to 8 MiB, to `/api/v1/photo-check`. Its 240-second deadline covers preparation and grading together. Failures require a manual retry. `/api/v1/photo-check/config` exposes the effective model label and mode without credentials or a paid call.

Inspect application logs locally when troubleshooting; do not publish environment dumps, authentication headers, keys or student images. Preserve the host Caddy configuration and existing authentication while deploying. The application has bounded concurrent photo requests; the shared tester login still does not provide per-person main-application identity.

## Structure agreed on 29 September 2026

Repository paths and deployment paths serve different purposes:

```text
Repository                         Runtime /srv/ege/app/
app/grading/                       app/grading/
app/legacy_grading/                app/legacy_grading/
tasks/common/prompts/              prompts/common/
tasks/16/prompts/                  prompts/16/
tasks/14..20/hypotheses/            (not deployed)
tasks/16/evals/, docs/              (not deployed)
```

Runtime `prompts/14`, `15`, `17`, `18`, `19`, `20` are reserved directories, not working task packages. Only task 16 is supported. The repository also preserves ideas and research per task; they are never automatically added to the model's file allowlist.

`/srv/ege/releases/photo-20260927/` is the dated staging/source directory used for the September 27 photo-service release. “photo” labels the upload workflow, not a dataset of student photographs. `/srv/ege/backups/` stores rollback snapshots. These historical operational directories are separate from the currently running source tree; retain them until rollback coverage is confirmed. Private student images belong to the separate private report storage described above.

## Verified reorganisation — 29 September 2026

The new layout is installed in `/srv/ege/app` and the running `ege-grading-api` container. `app/grading` is the current photo service; `app/legacy_grading` preserves the earlier APIs. Runtime `prompts/` contains common, legacy and every directory 14–20. No documentation, hypotheses, evals, tests or old grading_v2 directory is in the deployed source tree.

- Offline suite: **365 passed, 3 skipped**. Both providers forced to mock; no paid model calls.
- Repository development image and exported production image built successfully. A candidate container on the server, with networking disabled and mock providers, passed health, UI, seven-file package loading and multipart photo-check with a validated result.
- Installed service: `running / healthy`; direct health, new form and legacy console return HTTP 200. The unchanged real configuration reports `deepseek-v4-flash`; no grading request was sent to that provider.
- All 70 runtime payload files match the exported SHA-256 manifest. The server `.env` is byte-identical to the previous copy. Persistent report mounts and host authentication were preserved.
- Candidate source: `/srv/ege/releases/grading-20260929`; current image tag: `ege-grading:grading-20260929` (also `latest`). Full prior source, including private configuration: `/srv/ege/backups/app-before-grading-20260929` (mode 700). Prior image retained as `ege-grading:before-grading-20260929`.
- Six of seven current model files are byte-identical to the prior deployment. Only Main's opening phrase generalises “решение неравенства” to “решение задачи”. Existing local legacy prompt revisions were preserved when consolidating the newer worktree; previous deployed variants remain in the rollback snapshot. These structural checks do not rerun or improve the September 27 quality scores.

Build a runtime-only source tree from the repository:

```bash
python deploy/build_runtime.py /tmp/botai-runtime-new
```

The destination must be new or empty and outside the repository. The exporter writes a manifest and does not copy credentials. Build and smoke-test that candidate before installing it. Never deploy the whole research checkout with `rsync --delete` over the working server directory.

To roll back this release, restore the saved source tree to `/srv/ege/app`, retag `ege-grading:before-grading-20260929` as `ege-grading:latest`, and run production Compose with `up -d --no-build --force-recreate grading-api`. Keep the report directories and their identity secret intact. Do not overwrite the saved prior source with the failed candidate.

## Live smoke check before GitHub push — 29 September 2026

After the offline migration checks, the user explicitly authorized one real grading request. FIPI case `15.1.1` returned HTTP 200, a validated graded response and **2/2**, matching the hidden expected score, in **87.333 seconds**. No retry or further grading request was made. [Saved evidence](../tasks/16/evals/results/2026-09-29-smoke/README.md) records the model and request ID. The earlier “no paid model calls” statements describe the preceding migration phase, not this later authorized check.
