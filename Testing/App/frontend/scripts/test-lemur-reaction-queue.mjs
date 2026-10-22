import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

const motion = JSON.parse(readFileSync('src/config/lemur-hang-motion.json', 'utf8'));

for (const atSeam of [false, true]) {
  const returnAt = motion.reactionPhaseStep * (atSeam ? 3 : 1.5);
  test(`Fallback overlap ждёт реальную фазу сердечка: на шве=${atSeam}`, () => {
    const harness = hookHarness();
    const started = [];
    let callback;
    let now = 0;
    const video = {
      currentTime: motion.duration + returnAt - 1 / motion.fps,
      paused: false,
      playbackRate: 1,
      requestVideoFrameCallback(next) {
        callback = next;
        return 1;
      },
      cancelVideoFrameCallback() {
        callback = null;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const load = moduleLoader(
      { react: { ...harness.react, useEffectEvent: (fn) => fn } },
      {
        performance: { now: () => now },
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
      },
    );
    const { useLemurReactionQueue } = load('@/hooks/use-lemur-reaction-queue');
    harness.render(() =>
      useLemurReactionQueue(
        { current: video },
        true,
        true,
        { syncPeriod: motion.reactionPhaseStep, syncTolerance: 1 / motion.fps },
        (time) => started.push(time),
      ),
    );
    now += 1000 / motion.fps;
    video.currentTime = returnAt;
    callback(now, { mediaTime: video.currentTime });
    if (!atSeam) {
      assert.deepEqual(started, [], 'Возврат между швами не должен запускать несовпавшую позу');
      now += 1000 / motion.fps;
      video.currentTime = Math.ceil(returnAt / motion.reactionPhaseStep) * motion.reactionPhaseStep;
      callback(now, { mediaTime: video.currentTime });
    }
    assert.deepEqual(started, [video.currentTime]);
    harness.unmount();
    assert.equal(callback, null);
  });
}
