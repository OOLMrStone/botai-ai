#!/bin/sh
# The package is operator-owned and read-only; no fetch or public import endpoint exists.
set -eu
if test "$#" -lt 2 || test "$#" -gt 3; then
    echo 'Usage: publish-content.sh /absolute/package relative/manifest.jsonl [--publish]' >&2
    exit 2
fi
TASK_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
PACKAGE_ROOT=$1
MANIFEST=$2
PUBLISH=false
case "$PACKAGE_ROOT" in /*) ;; *) echo 'Package root must be absolute' >&2; exit 2 ;; esac
case "$MANIFEST" in /*|*..*|*\\*) echo 'Manifest must stay inside the package' >&2; exit 2 ;; esac
if test "$#" = 3; then
    test "$3" = '--publish' || exit 2
    PUBLISH=true
fi
test -f "$PACKAGE_ROOT/$MANIFEST"
cd "$TASK_ROOT"
# compose.sh targets only the owned local/stage stack. Migration is a separate reviewed deployment step.
exec sh scripts/integration/compose.sh run --rm --no-deps -T \
    --user "$(id -u):$(id -g)" \
    --volume "$PACKAGE_ROOT:/imports:ro" --env APP_GRADING_WORKER_ENABLED=false \
    content-import --spring.profiles.active=content-import \
    --spring.flyway.enabled=false --spring.session.jdbc.cleanup-cron=- --server.address=127.0.0.1 --server.port=0 \
    --management.server.address=127.0.0.1 --management.server.port=0 \
    --logging.level.root=ERROR --spring.main.banner-mode=off \
    --app.content-import.manifest="/imports/$MANIFEST" \
    --app.content-import.package-root=/imports --app.content-import.publish="$PUBLISH"
