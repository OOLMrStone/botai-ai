#!/bin/sh
# Inside the develop container: figure call alone on the 15 circle works, then 8 narrow strips without resolve.
cd /srv
export PYTHONPATH=/srv
BENCH_VARIANT=circle BENCH_SKIP_READ=1 BENCH_CIRCLE=/tmp/bench/prompt_circle.txt \
  BENCH_ONLY=13.1.1,13.1.2,13.1.3,13.2.1,13.2.3,13.3.1,13.3.3,13.4.2,13.4.3,505470.1,513071.1,515919.2,515919.3,559481.1,559481.2 \
  python /tmp/bench/reader_bench.py > /tmp/bench/run_circle.log 2>&1
python /tmp/bench/circle_judge.py /tmp/bench/key.json /tmp/bench/out_circle.json >> /tmp/bench/run_circle.log 2>&1
BENCH_VARIANT=strips8 BENCH_STRIPS=8 BENCH_RESOLVE=off python /tmp/bench/reader_bench.py > /tmp/bench/run_strips8.log 2>&1
echo CHAIN2 DONE >> /tmp/bench/run_strips8.log
