import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleLoader, deferred } from './helpers/hook-harness.mjs';

const { createStudyTimer, createStudyTimerLifecycle, formatTimerSeconds } =
  moduleLoader()('@/lib/study-timer');
function setup() {
  let now = 0;
  let sequence = 0;
  const calls = [];
  const accepted = [];
  let send = async (command) => ({
    sessionId: 'session',
    active: command.kind !== 'pause',
    attemptActiveSeconds: 60,
    maxGapSeconds: 45,
  });
  const timer = createStudyTimer({
    attemptId: 'attempt',
    clientId: 'client',
    now: () => now,
    eventId: () => `event-${++sequence}`,
    send: (command) => {
      calls.push(command);
      return send(command);
    },
    accept: (state) => accepted.push(state),
    changed() {},
  });
  return {
    timer,
    calls,
    accepted,
    advance: (seconds) => {
      now += seconds * 1000;
    },
    respond: (next) => {
      send = next;
    },
  };
}

test('visible time extends authoritative total; hidden time stays frozen', async () => {
  const s = setup();
  await s.timer.setActive(true);
  s.advance(12);
  assert.equal(s.timer.view().seconds, 72);
  await s.timer.setActive(false);
  s.advance(30);
  assert.equal(s.timer.view().seconds, 60);
  assert.equal(s.timer.view().status, 'paused');
  await s.timer.tick();
  assert.deepEqual(
    s.calls.map((c) => c.kind),
    ['start', 'pause'],
  );
});

test('failed heartbeat retries the same event; totals are replaced, not accumulated', async () => {
  const s = setup();
  await s.timer.setActive(true);
  s.respond(async () => {
    throw new TypeError('offline');
  });
  await s.timer.tick();
  assert.equal(s.timer.view().status, 'offline');
  s.advance(20);
  assert.equal(s.timer.view().seconds, 60);
  s.respond(async () => ({
    sessionId: 'session',
    active: true,
    attemptActiveSeconds: 75,
    maxGapSeconds: 45,
  }));
  await s.timer.tick();
  assert.equal(s.calls[1].eventId, s.calls[2].eventId);
  assert.equal(s.timer.view().seconds, 75);
});

test('blur while starting serializes pause after start, without updating disposed UI', async () => {
  const s = setup();
  const start = deferred();
  s.respond((command) =>
    command.kind === 'start'
      ? start.promise
      : Promise.resolve({
          sessionId: 'session',
          active: false,
          attemptActiveSeconds: 0,
          maxGapSeconds: 45,
        }),
  );
  const begun = s.timer.setActive(true);
  const stopped = s.timer.dispose();
  start.resolve({ sessionId: 'session', active: true, attemptActiveSeconds: 0, maxGapSeconds: 45 });
  await Promise.all([begun, stopped]);
  assert.deepEqual(
    s.calls.map((c) => c.kind),
    ['start', 'pause'],
  );
  assert.equal(s.accepted.length, 0);
});

test('another tab takes over; heartbeat cannot steal its session back', async () => {
  const s = setup();
  await s.timer.setActive(true);
  s.respond(async () => {
    throw { code: 'activity_session_stale' };
  });
  await s.timer.tick();
  await s.timer.tick();
  assert.equal(s.timer.view().status, 'elsewhere');
  assert.equal(s.calls.length, 2);
});

test('failed pause never replays hidden time on return', async () => {
  const s = setup();
  await s.timer.setActive(true);
  s.respond(async () => {
    throw new TypeError('offline');
  });
  await s.timer.setActive(false);
  s.advance(30);
  s.respond(async () => ({
    sessionId: 'new',
    active: true,
    attemptActiveSeconds: 60,
    maxGapSeconds: 45,
  }));
  await s.timer.setActive(true);
  assert.deepEqual(
    s.calls.map((c) => c.kind),
    ['start', 'pause', 'start'],
  );
  assert.equal(s.timer.view().seconds, 60);
});

test('display stops estimating beyond server lease and formats minute boundary', async () => {
  const s = setup();
  await s.timer.setActive(true);
  s.advance(100);
  assert.equal(s.timer.view().seconds, 105);
  assert.equal(formatTimerSeconds(61), '1:01');
});

for (const idleIntermediate of [false, true]) {
  test(`new attempt waits for delayed start and pause of disposed attempt${idleIntermediate ? ', across an inactive mount' : ''}`, async () => {
    const createTimer = createStudyTimerLifecycle();
    const oldStart = deferred();
    const oldStarted = deferred();
    const oldPause = deferred();
    const oldPausing = deferred();
    const calls = [];
    let state = null;
    let sequence = 0;
    const timerFor = (id) =>
      createTimer({
        attemptId: id,
        clientId: id,
        now: () => 0,
        eventId: () => `event-${++sequence}`,
        async send(command) {
          calls.push(`${id}:${command.kind}`);
          if (id === 'old' && command.kind === 'start') {
            oldStarted.resolve();
            await oldStart.promise;
          }
          if (id === 'old' && command.kind === 'pause') {
            oldPausing.resolve();
            await oldPause.promise;
          }
          if (command.kind === 'start') {
            state = { sessionId: id, active: true, attemptActiveSeconds: 0, maxGapSeconds: 45 };
          } else {
            if (state.sessionId !== command.sessionId || !state.active)
              throw { code: 'activity_session_stale' };
            state = { ...state, active: command.kind !== 'pause' };
          }
          return state;
        },
        accept() {},
        changed() {},
      });

    const old = timerFor('old');
    const started = old.setActive(true);
    await oldStarted.promise;
    const disposed = old.dispose();
    if (idleIntermediate) void timerFor('intermediate').dispose();
    const current = timerFor('current');
    const currentStarted = current.setActive(true);
    await Promise.resolve();
    assert.deepEqual(calls, ['old:start']);

    oldStart.resolve();
    await oldPausing.promise;
    assert.deepEqual(calls, ['old:start', 'old:pause']);
    oldPause.resolve();
    await Promise.all([started, disposed, currentStarted]);
    await current.tick();

    assert.deepEqual(calls, ['old:start', 'old:pause', 'current:start', 'current:heartbeat']);
    assert.equal(state.sessionId, 'current');
    assert.equal(state.active, true);
    assert.equal(current.view().status, 'active');
  });
}
