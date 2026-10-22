# B2B partner runtime

This backend is included under `Testing/App/backend` in a clean checkout of
`botai-ai` on `main`, together with the matching frontend and partner bootstrap.
See the canonical [testing application instructions](../../../prompt.md).
The bootstrap prepares the approved source export and public FIPI fixture package. No existing runtime,
credentials, provider key, database dump or private upload is needed or shared.

Host prerequisites are Python 3, Git, Docker with Compose v2 and a local Unix
Docker socket. The frontend needs the Node version documented beside its source.
Java 21 and Python/Pillow dependencies are built in containers. Windows users
run the shell scripts in WSL with Docker Desktop integration.

The default profile preserves the existing sandbox: project `botai-b2b-local`,
private directory `runtime/b2b-local`, frontend port 13004, API port 18086 and
Mailpit port 18027. For an independent clean-clone check alongside that sandbox,
set `B2B_LOCAL_INSTANCE=partner-check` on **every** command. This selects project
`botai-b2b-local-partner-check`, private directory
`runtime/b2b-local-partner-check` and ports 13014/18096/18037 respectively.
Only these two profiles are accepted; `scripts/b2b-local/common.py` is the
canonical profile definition. Containers, images, networks and volumes are
separate. All published ports bind only to 127.0.0.1.

The startup order, from this repository, is:

1. `python3 scripts/b2b-local/init.py` generates credentials once.
2. `python3 scripts/b2b-local/prepare-ai.py --source /absolute/clean/botai-ai --approved-head FULL_COMMIT_SHA`
   exports the exact clean AI source without research, expected answers or keys.
3. `python3 scripts/b2b-local/prepare-fixtures.py --manifest /absolute/generated/manifest.json`
   copies the selected, public source assets into the private runtime.
4. `python3 scripts/b2b-local/start.py` pulls pinned infrastructure images,
   builds AI/backend/PDF images and starts the mock runtime.
5. `python3 scripts/b2b-local/seed.py` creates the synthetic accounts and school
   assignments. It creates no submissions and makes no model call.
6. Recreate only this profile's backend with its generated image override to
   apply the expert operator allowlist. For the default profile:
   `scripts/b2b-local/compose.sh -f runtime/b2b-local/mock-images.compose.json up -d --no-deps --no-build --pull never --force-recreate --wait backend`.
   For `partner-check`, use `runtime/b2b-local-partner-check/mock-images.compose.json`.
7. `python3 scripts/b2b-local/smoke-read.py` checks account/role isolation,
   assignments, task images and CSRF without submitting work or calling models.

Use `scripts/b2b-local/compose.sh` for all runtime commands; do not merge this
compose file with another environment. Account passwords are in the selected
private directory's `credentials.json`. The student uses
`alexey.smirnov@math.example`; expert and developer views use
`maria.orlova@math.example`, each through its own hostname/session.

The frontend routes are `/school` on `student.localhost`, `/grade` on
`expert.localhost`, and `/grade/dev` on `dev.localhost`, on the selected frontend
port. Set its `BACKEND_URL` to the selected loopback API address.

Mock mode needs no provider key and does not assess mathematical correctness.
Real-provider activation is separate and explicit; existing live runtimes are
never silently switched by this startup command.
