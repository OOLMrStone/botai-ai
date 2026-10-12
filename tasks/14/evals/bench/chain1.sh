#!/bin/sh
# Inside the develop container: experiments noresolve and short prompt, one after another, then circle checks.
cd /srv
export PYTHONPATH=/srv
python -c "
from app.grading.reader import READER_PROMPT
text = READER_PROMPT.replace('\nНиже — что встречается в таких решениях и как это распознавать.', '')
open('/tmp/bench/prompt_short.txt', 'w', encoding='utf-8').write(text)
"
BENCH_VARIANT=noresolve BENCH_RESOLVE=off python /tmp/bench/reader_bench.py > /tmp/bench/run_noresolve.log 2>&1
python /tmp/bench/circle_judge.py /tmp/bench/key.json /tmp/bench/out_noresolve.json >> /tmp/bench/run_noresolve.log 2>&1
BENCH_VARIANT=short BENCH_PROMPT=/tmp/bench/prompt_short.txt python /tmp/bench/reader_bench.py > /tmp/bench/run_short.log 2>&1
python /tmp/bench/circle_judge.py /tmp/bench/key.json /tmp/bench/out_short.json >> /tmp/bench/run_short.log 2>&1
echo CHAIN1 DONE >> /tmp/bench/run_short.log
