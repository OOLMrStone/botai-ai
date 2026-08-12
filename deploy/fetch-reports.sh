#!/usr/bin/env bash
# Pull every run report off the server and summarise the test session.
#
#   ./deploy/fetch-reports.sh [destination-dir]
#
# Reports are plain JSON files, one per run, grouped by date. Copying them is
# the whole collection step — there is no database to dump.
set -euo pipefail

HOST="${EGE_HOST:-ege-server}"
DEST="${1:-./collected-reports}"

mkdir -p "$DEST"
echo "pulling from $HOST:/srv/ege/reports → $DEST"
rsync -az -e ssh "$HOST:/srv/ege/reports/" "$DEST/"

python3 - "$DEST" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
rows = []
for path in sorted(root.rglob("*.json")):
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        continue
    g, fb = d.get("grades") or {}, d.get("feedback") or {}
    rows.append({
        "id": d.get("request_id", "?"),
        "when": (d.get("created_at") or "")[:16],
        "task": d.get("task_number"),
        "ok": d.get("ok"),
        "base": (g.get("base") or {}).get("score"),
        "pres": (g.get("presentation") or {}).get("score"),
        "max": g.get("max_score"),
        "flags": ",".join(sorted(d.get("features_changed") or {})) or "-",
        "verdict": fb.get("verdict", ""),
        "comment": (fb.get("comment") or "").replace("\n", " ")[:60],
        "tester": fb.get("tester", ""),
        "cost": (d.get("total_cost") or {}).get("usd"),
    })

if not rows:
    print("no reports found"); sys.exit()

print(f"\n{len(rows)} runs\n")
head = f"{'when':<17}{'task':<5}{'оценки':<9}{'флаги':<24}{'вердикт':<9}{'кто':<14}комментарий"
print(head); print("-" * len(head))
for r in rows:
    grades = "—" if r["base"] is None else f"{r['base']}/{r['pres']} из {r['max']}"
    mark = {"wrong": "НЕВЕРНО", "ok": "верно", "unsure": "не увер."}.get(r["verdict"], "")
    print(f"{r['when']:<17}{str(r['task']):<5}{grades:<9}{r['flags']:<24}{mark:<9}{r['tester']:<14}{r['comment']}")

disputed = [r for r in rows if r["verdict"] == "wrong"]
spend = sum(r["cost"] or 0 for r in rows)
print(f"\nоспорено тестировщиками: {len(disputed)} из {len(rows)}")
print(f"потрачено (оценка): ${spend:.4f}")
if disputed:
    print("\nразбирать в первую очередь:")
    for r in disputed:
        print(f"  {r['id']}  {r['comment']}")
PY
