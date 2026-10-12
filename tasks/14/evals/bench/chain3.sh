#!/bin/sh
# Inside the develop container: noise check on the hard set, 3 repeats of each variant, strips only (no resolve).
cd /srv
export PYTHONPATH=/srv
export BENCH_RESOLVE=off
export BENCH_ONLY=13.1.2,13.2.3,13.3.3,13.6.3,500366.1,505470.1,513092.1,515919.2,515919.3,13.1.4,13.4.4,559481.1
for r in 1 2 3; do
  BENCH_VARIANT=s8t0_r$r BENCH_STRIPS=8 BENCH_TEMP=0 python /tmp/bench/reader_bench.py > /tmp/bench/run_s8t0_r$r.log 2>&1
  BENCH_VARIANT=s8_r$r BENCH_STRIPS=8 python /tmp/bench/reader_bench.py > /tmp/bench/run_s8_r$r.log 2>&1
  BENCH_VARIANT=s3_r$r python /tmp/bench/reader_bench.py > /tmp/bench/run_s3_r$r.log 2>&1
done
echo CHAIN3 DONE > /tmp/bench/chain3.done
