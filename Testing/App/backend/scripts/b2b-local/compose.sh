#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$TASK_ROOT"
TASK_PROFILE=$(python3 scripts/b2b-local/common.py --shell-profile)
eval "$TASK_PROFILE"
test ! -L "$B2B_RUNTIME_DIR"
test ! -L "$B2B_RUNTIME_DIR/ISOLATED_B2B_LOCAL"
test "$(cat "$B2B_RUNTIME_DIR/ISOLATED_B2B_LOCAL" 2>/dev/null)" = "$B2B_PROJECT" || {
    echo 'Run python3 scripts/b2b-local/init.py first' >&2; exit 1;
}
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
unset POSTGRES_PASSWORD APP_DB_PASSWORD OPS_DB_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY \
    AI_SERVICE_TOKEN FRONTEND_BASE_URL APP_B2B_OPERATOR_USER_IDS B2B_SEED_UID
# The demo must never follow an inherited SSH/TCP Docker endpoint.
case "${DOCKER_HOST:-}" in ''|unix://*) ;; *)
    echo 'B2B demo requires a local Unix Docker socket' >&2; exit 1;; esac
TASK_DOCKER_ENDPOINT=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')
case "$TASK_DOCKER_ENDPOINT" in unix://*) ;; *)
    echo 'B2B demo requires a local Unix Docker context' >&2; exit 1;; esac
exec docker compose --project-name "$B2B_PROJECT" --env-file "$B2B_RUNTIME_DIR/.env" \
    -f compose.b2b-local.yaml "$@"
