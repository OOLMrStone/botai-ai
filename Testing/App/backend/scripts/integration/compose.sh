#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$TASK_ROOT"
if test -f runtime/STAGE; then
    exec docker compose --env-file runtime/.env.integration -f compose.integration.yaml -f compose.stage.yaml "$@"
fi
exec docker compose --env-file runtime/.env.integration -f compose.integration.yaml "$@"
