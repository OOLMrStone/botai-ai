#!/bin/bash
# After the v6c retries: deploy v6e (reader only for 14 and 15), run task 18 on FIPI and Reshu.
while pgrep -f chain_v6cfix.sh >/dev/null; do sleep 30; done
set -e
cd /mnt/c/Users/kosti/Desktop/botai-ai
rm -rf ~/rt-tr && ~/botai-venv/bin/python deploy/build_runtime.py ~/rt-tr >/dev/null
(cd ~/rt-tr/prompts && find . -type f | sort | xargs sha256sum > ~/local_tr.sha)
K="-o BatchMode=yes -o LogLevel=ERROR -i $HOME/.ssh/botai_dev"; H=botai-dev@135.106.182.11
ssh $K $H "rm -rf /srv/develop/tr && mkdir -p /srv/develop/tr/grading /srv/develop/tr/prompts"
scp -q $K ~/rt-tr/app/grading/{package,provider,service,session,reader}.py $H:/srv/develop/tr/grading/
scp -q $K -r ~/rt-tr/prompts/. $H:/srv/develop/tr/prompts/
ssh $K $H "cd /srv/develop && docker build -q -f Dockerfile.transcript -t botai-develop:local . >/dev/null && docker tag botai-develop:local botai-develop:v6e && docker compose up -d --no-build 2>&1 | tail -1"
sleep 20
ssh $K $H "docker exec botai-develop sh -c \"cd /srv/prompts && find . -type f | sort | xargs sha256sum\"" > ~/remote_v6e.sha
if diff -q ~/local_tr.sha ~/remote_v6e.sha >/dev/null; then echo DEPLOY_OK; else echo DEPLOY_MISMATCH; exit 1; fi
ssh $K $H "docker exec botai-develop grep -c READER_TASKS /srv/app/grading/service.py" || { echo CODE_MISMATCH; exit 1; }
set +e
cd /mnt/c/Users/kosti/Desktop/botai-ai
export CONC=1 RETRIES=1
~/run_evals.sh v6e 18
for p in $(ps -eo pid,args | grep -E "[s]sh .*-L 127.0.0.1:18080" | awk "{print \$1}"); do kill $p; done
ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o LogLevel=ERROR -i ~/.ssh/botai_dev -L 127.0.0.1:18080:127.0.0.1:18080 $H || { echo "tunnel failed"; exit 1; }
sleep 2
~/botai-venv/bin/python scripts/run_photo_evals.py --run-name v6ereshu-18 --manifest /mnt/c/Users/kosti/Desktop/botai-references/reshu/evals/18/manifest-keep.json --endpoint http://127.0.0.1:18080/api/v1/photo-check --concurrency 1 --resume --retries 1
for p in $(ps -eo pid,args | grep -E "[s]sh .*-L 127.0.0.1:18080" | awk "{print \$1}"); do kill $p; done
echo ALL_DONE
