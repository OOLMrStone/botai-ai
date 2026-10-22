#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$TASK_ROOT"
test -f runtime/evidence/billing-test/compose.env || { echo 'Run billing-test-runtime.py init first' >&2; exit 1; }
# Explicit project and file prevent inherited COMPOSE_* settings selecting another stack.
exec docker compose --project-name botai-billing-test --env-file runtime/evidence/billing-test/compose.env -f compose.billing-test.yaml "$@"
