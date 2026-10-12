#!/bin/bash
# usage: run_evals.sh <run-prefix> <task> [case ...]   (no cases = whole manifest)
set -u
PREFIX=$1; TASK=$2; shift 2
cd /mnt/c/Users/kosti/Desktop/botai-ai
ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o LogLevel=ERROR \
    -i ~/.ssh/botai_dev -L 127.0.0.1:18080:127.0.0.1:18080 botai-dev@135.106.182.11 || { echo "tunnel failed"; exit 1; }
sleep 2
curl -s -m 10 http://127.0.0.1:18080/api/v1/photo-check/config | grep -q '"tasks"' || { echo "config check failed"; pkill -f "18080:127.0.0.1:18080"; exit 1; }
ARGS=()
for c in "$@"; do ARGS+=(--case "$c"); done
~/botai-venv/bin/python scripts/run_photo_evals.py --run-name "$PREFIX-$TASK" \
    --manifest "tasks/$TASK/evals/fipi/manifest.json" \
    --endpoint http://127.0.0.1:18080/api/v1/photo-check --concurrency ${CONC:-2} --resume --retries ${RETRIES:-0} "${ARGS[@]}"
echo "exit=$?"
pkill -f "18080:127.0.0.1:18080"
