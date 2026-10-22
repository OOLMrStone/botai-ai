#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$TASK_ROOT"
test -f runtime/expert-local/ISOLATED_EXPERT_LOCAL || {
    echo 'Run python3 scripts/expert-local/init.py first' >&2; exit 1;
}
# A fixed project/file/db prevents inherited COMPOSE_* from targeting another stack.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
unset POSTGRES_PASSWORD APP_DB_PASSWORD OPS_DB_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY \
    AI_SERVICE_TOKEN FRONTEND_BASE_URL FRONT_CONTEXT
exec docker compose --project-name botai-expert-local --env-file runtime/expert-local/.env \
    -f compose.expert-local.yaml "$@"
