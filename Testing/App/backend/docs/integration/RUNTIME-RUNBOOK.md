# Isolated mock runtime

Requirements: Docker+Compose, Python3; repositories `botai-back`, `botai-front`, `botai-ai` as siblings. Backend build/runtime uses pinned Java21; host Java25 unchanged. No installation/paid inference required. Private single-node Garage is a test fixture without redundancy; see [official quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/).

```sh
python3 scripts/integration/start.py --with-frontend --ops
python3 scripts/integration/provision-dev.py --confirm-isolated-development
python3 scripts/integration/api-smoke.py --base-url http://127.0.0.1:13000
python3 scripts/integration/backup-rehearsal.py
scripts/integration/compose.sh ps
```

`start.py` checks owned/foreign listeners before binding ports; preserves env and volumes; exports only allowed AI runtime. For frontend hot development omit `--with-frontend` and start from front repo: `BACKEND_URL=http://127.0.0.1:18082 npm run dev:api -- --hostname 127.0.0.1 --port 13000`. Stop that dev process before production frontend container. Credentials generator never prints values. Open `runtime/credentials.json` locally for login/Adminer; private0600 `.env.integration` and `garage.toml` are not committed.

Ports are loopback only: front13000, backend18082, SMTP inbox18025, optional ops18090. PG/S3/AI/management8081 have no host ports. AI isolated internal network/no external egress and no storage/database credentials. Browser only uses same-origin `/api`; Next BACKEND_URL is fixed when build rewrites are generated, so rebuild image to change backend destination. Mock16 results and synthetic task fixtures are marked demo and never award real progress.

`compose.sh stop` preserves data. Never use `down -v`, Flyway repair, DROP or existing production volumes. Safe restart: `compose.sh up -d --wait`; change env then `up -d --force-recreate` for affected service. Logs rotate3×10MiB, services have memory limits, Mailpit keeps200 messages, Garage bucket capped4GiB/10000objects. Media cleanup belongs to backend persisted lifecycle; expired incomplete multipart cleanup: `compose.sh exec garage /garage bucket cleanup-incomplete-uploads botai --older-than 1d`. No blanket bucket wipe.

Backup script briefly quiesces backend+Garage, creates PG custom dump and physical Garage metadata/data snapshots, immediately restarts active services then rehearses restoration on isolated temporary volumes. Schedule a quiet window with browser testers. Dumps/config and snapshot directories are private; retain newest3. It never stops/replaces production. Rehearsal row-count/byte equality checks are not a claim about production backup readiness.

For server stage use independent sources and fresh secrets in `/srv/botai-integration`, exact same mock stack, env project `botai-integration-stage`. Keep `back/runtime` symlink to `../runtime` and `runtime/backups` symlink to `../backups`; `FRONT_CONTEXT=../front`, `AI_CONTEXT=../ai`. Main auth/AI/front and developer firewall/gateway stay untouched. Never copy local private env or user uploads; export AI only through `deploy/build_runtime.py`. Review local+stage+security evidence before any live proxy/container switch.

SSH preview (production stage frontend/backend/ops running):

```sh
ssh -N -L localhost:23000:127.0.0.1:13000 \
  -L localhost:28082:127.0.0.1:18082 \
  -L localhost:28090:127.0.0.1:18090 \
  -L localhost:28025:127.0.0.1:18025 ege-server
```

Current measured state and remaining frontend gates are recorded in RUNTIME-EVIDENCE.md. Stage credentials are `/srv/botai-integration/runtime/credentials.json`; private demo/operator copy is local `runtime/evidence/stage-credentials.json`0600. They differ from local fixtures.

## Stage transfer preparation

`python3 scripts/integration/prepare-stage.py` creates a private code-only archive and SHA256 metadata under runtime/evidence. It verifies every AI manifest digest, selects backend build/source/runtime scripts and frontend src/public/scripts/configs, excludes symlinks, .env, research, uploads and generated caches. Regenerate after final frontend freeze; do not copy private local env.

Before remote extraction, confirm `/srv/botai-integration` is absent or has the expected `.botai-isolated-integration` marker, check available disk and listeners13000/18082/18090/18025, and preserve existing production listeners. Transfer the archive through existing SSH, extract only into the separate stage directory. From stage back run `python3 scripts/integration/stage-bootstrap.py --confirm-isolated-stage --start`; it generates fresh private secrets, creates the separated runtime/backups layout, starts mock-only containers and checks the same-origin HTTP gate. Bootstrap and native backend/AI deployment have run successfully; both final production frontend images are now built and healthy. For infrastructure-only startup use `start.py --skip-build --ops`; bootstrap `--start` includes final frontend and its same-origin check. Never install/upgrade Docker/apt, alter SSH/firewall/Caddy, or replace live routes in this procedure.

## Shared-server build limits

`compose.stage.yaml` is automatically included by the private `runtime/STAGE` marker. Build services sequentially; backend Gradle is limited to2workers/Xmx384MiB. Use the dedicated builder for final frontend native build (refresh approved frontend sources first):

```sh
docker buildx inspect botai-stage-build --bootstrap
docker buildx build --builder botai-stage-build --load \
  --build-arg BACKEND_URL=http://backend:8080 \
  -f ../front/Dockerfile.integration -t botai-integration-stage-frontend ../front
docker buildx stop botai-stage-build
scripts/integration/compose.sh --profile web --profile ops up -d --wait
python3 scripts/integration/api-smoke.py --base-url http://127.0.0.1:13000
```

Builder memory/swap cap1.5GiB and CPU1.5; frontend Node heap1GiB. Dedicated `buildkit.stage.toml` sets parallelism1/cache GC2GiB/min-free8GiB ([official BuildKit settings](https://docs.docker.com/build/buildkit/toml-configuration/)). Stop the dedicated builder between builds. Preserve its cache while waiting; only bounded pruning of this builder is allowed, never global production pruning. Existing isolated stage migration credentials are a staging limitation: move Flyway to a one-shot job before public/live exposure, as required by SECURITY-CODE-REVIEW.md.

Browser origins are separate: local `http://127.0.0.1:13000`, server stage `http://localhost:23000`. Cookies ignore ports, so using the same hostname for both stacks would collide SESSION/XSRF cookies. Stage `FRONTEND_BASE_URL=http://localhost:23000` ensures its email links return to the stage database. Backend-only recreate applies this env change without changing volumes. Verify mail origin privately with `python3 scripts/integration/email-origin-smoke.py --expected-origin http://localhost:23000` on stage; tokens and passwords are never printed.

Launch/reconnect the owned persistent SSH tunnel with `python3 scripts/integration/stage-tunnel.py` (foreground service; three failed reconnects stop for diagnosis). It uses control socket `runtime/stage-tunnel.sock`; inspect with `ssh -S runtime/stage-tunnel.sock -O check ege-server`, stop only this tunnel with `-O exit`. Keep it running for preview; it forwards localhost23000/28082/28090/28025.

For final source parity, run on the local Mac repo: after frontend owner supplies its freeze SHA, run `prepare-front-context.py --expected-sha256 SHA`. It validates all approved source/config bytes then copies an immutable private-free context to `runtime/evidence/front-context-final`; build that context locally and transfer by checksum delta to a separate stage `front-next` copy, verify `frontend-final-manifest.json`, then atomically swap the isolated source directory. Preserve previous stage frontend source and active volumes. Never chain deployment after a failed snapshot validation.
