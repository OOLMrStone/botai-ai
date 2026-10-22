import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, hookHarness, moduleLoader, settle } from './helpers/hook-harness.mjs';

const { recentAttempts, countFittingAttempts } = moduleLoader()('@/lib/attempt-list');

test('recent cards use last exit, include results, and ignore rename/autosave dates', () => {
  const attempts = [
    { id: 'renamed', createdAt: '2026-10-01', updatedAt: '2026-10-10', lastExitedAt: '2026-10-03' },
    { id: 'completed', status: 'completed', createdAt: '2026-10-02', lastExitedAt: '2026-10-07' },
    { id: 'new', createdAt: '2026-10-06', lastExitedAt: null },
  ];
  assert.deepEqual(
    recentAttempts(attempts).map((attempt) => attempt.id),
    ['completed', 'new', 'renamed'],
  );
  assert.equal(attempts[0].id, 'renamed');
  assert.equal(recentAttempts(null), null);
});

test('capacity keeps a whole recent prefix, including exact fits and taller titles', () => {
  assert.equal(countFittingAttempts(272, [120, 140, 120], 12), 2);
  assert.equal(countFittingAttempts(271.9, [120, 140, 120], 12), 1);
  assert.equal(countFittingAttempts(404, [120, 140, 120], 12), 3);
  assert.equal(countFittingAttempts(120, [121, 80], 12), 0);
  assert.equal(countFittingAttempts(0, [120], 12), 0);
  assert.equal(countFittingAttempts(404, [], 12), 0);
});

function exitFixture() {
  const harness = hookHarness();
  const events = new Map();
  const requests = [];
  let sequence = 0;
  let invalidations = 0;
  let send = async () => {};
  const load = moduleLoader(
    {
      react: harness.react,
      '@/config/env': { IS_MOCK_API: false },
      '@/lib/api/learning': {
        recordAttemptExit: (...args) => {
          requests.push(args);
          return send();
        },
      },
      '@/lib/learning-resources': { invalidateAttempts: () => invalidations++ },
    },
    {
      crypto: { randomUUID: () => `event-${++sequence}` },
      queueMicrotask,
      window: {
        addEventListener: (name, listener) => events.set(name, listener),
        removeEventListener: (name) => events.delete(name),
      },
    },
  );
  const { useAttemptExit } = load('@/hooks/use-attempt-exit');
  return {
    harness,
    requests,
    render: (id = 'attempt', enabled = true) => harness.render(() => useAttemptExit(id, enabled)),
    emit: (name, event = {}) => events.get(name)?.(event),
    respond: (next) => (send = next),
    invalidations: () => invalidations,
  };
}

test('exit waits, deduplicates double click/pagehide, and retries the same event after failure', async () => {
  const s = exitFixture();
  const pending = deferred();
  s.respond(() => pending.promise);
  const exit = s.render();
  const first = exit.recordExit();
  assert.equal(exit.recordExit(), first);
  s.emit('pagehide');
  assert.equal(s.requests.length, 1);
  pending.reject(new TypeError('offline'));
  await assert.rejects(first);
  assert.equal(s.invalidations(), 0);
  s.respond(async () => {});
  await exit.recordExit();
  assert.deepEqual(s.requests[0], s.requests[1]);
  assert.equal(s.invalidations(), 1);
  s.harness.unmount();
  await settle();
  assert.equal(s.requests.length, 2);
});

test('reload/pagehide records without edits and restored back-cache page gets a new exit event', async () => {
  const s = exitFixture();
  s.render();
  s.emit('pagehide');
  await settle();
  assert.equal(s.requests.length, 1);
  s.emit('pageshow', { persisted: true });
  s.emit('pagehide');
  await settle();
  assert.equal(s.requests.length, 2);
  assert.notEqual(s.requests[0][1], s.requests[1][1]);
});

test('route departure records old attempt even without answer changes; disabled screen does not', async () => {
  const s = exitFixture();
  await s.render('loading', false).recordExit();
  assert.equal(s.requests.length, 0);
  s.render('old');
  s.render('new');
  await settle();
  assert.equal(s.requests[0][0], 'old');
  s.harness.unmount();
  await settle();
  assert.equal(s.requests[1][0], 'new');
});

test('exit API sends a small keepalive mutation so reload can finish the request', async () => {
  const requests = [];
  const load = moduleLoader({ '@/lib/api/client': { apiFetch: (...args) => requests.push(args) } });
  await load('@/lib/api/learning').recordAttemptExit('attempt', 'event');
  assert.deepEqual(requests, [
    ['/api/attempts/attempt/exit', { json: { eventId: 'event' }, keepalive: true }],
  ]);
});

function capacityFixture(cardHeights, initialHeight) {
  const harness = hookHarness();
  let height = initialHeight;
  const rows = cardHeights.map((height) => ({ getBoundingClientRect: () => ({ height }) }));
  const list = { getBoundingClientRect: () => ({ height }), children: [] };
  const observers = [];
  const load = moduleLoader(
    { react: harness.react },
    {
      getComputedStyle: () => ({ rowGap: '12px' }),
      ResizeObserver: class {
        constructor(callback) {
          this.measure = callback;
          this.observed = [];
          observers.push(this);
        }
        observe(element) {
          this.observed.push(element);
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    },
  );
  const { useHomeAttemptCapacity } = load('@/hooks/use-home-attempt-capacity');
  const ids = rows.map((_, index) => String(index));
  const render = (enabled = true, nextIds = ids) =>
    harness.render(() => {
      const state = useHomeAttemptCapacity(enabled, nextIds);
      state.listRef.current = list;
      list.children = rows.slice(0, state.renderCount);
      return state;
    });
  const measureUntilStable = () => {
    let previous = render();
    for (let pass = 0; pass < rows.length + 2; pass++) {
      observers.at(-1).measure();
      const next = render();
      assert.ok(list.children.length <= next.visibleCount + 1);
      if (next.visibleCount === previous.visibleCount && next.renderCount === previous.renderCount)
        return next;
      previous = next;
    }
    assert.fail('capacity did not settle');
  };
  return {
    render,
    measureUntilStable,
    observers,
    rows,
    list,
    harness,
    resize: (next) => {
      height = next;
    },
  };
}

test('capacity grows from one measured row, preserves variable heights, and adjusts to both resize directions', () => {
  const s = capacityFixture([120, 140, 120, 100], 272);
  assert.equal(s.render().renderCount, 1);
  assert.deepEqual(s.observers[0].observed, [s.list, s.rows[0]]);
  let state = s.measureUntilStable();
  assert.equal(state.visibleCount, 2);
  assert.equal(state.renderCount, 3);
  assert.equal(s.list.children.length, 3);
  s.resize(404);
  state = s.measureUntilStable();
  assert.equal(state.visibleCount, 3);
  assert.equal(state.renderCount, 4);
  s.resize(120);
  state = s.measureUntilStable();
  assert.equal(state.visibleCount, 1);
  assert.equal(state.renderCount, 2);
  s.rows[0].getBoundingClientRect = () => ({ height: 121 });
  state = s.measureUntilStable();
  assert.equal(state.visibleCount, 0);
  assert.equal(state.renderCount, 1);
  const lastObserver = s.observers.at(-1);
  s.render(true, ['replacement', '1', '2', '3']);
  assert.equal(lastObserver.disconnected, true);
  s.harness.unmount();
  assert.equal(s.observers.at(-1).disconnected, true);
});

test('thousands of home attempts mount only the fitting prefix plus one reserve; history stays complete', () => {
  const s = capacityFixture(Array(1000).fill(120), 272);
  const state = s.measureUntilStable();
  assert.equal(state.visibleCount, 2);
  assert.equal(state.renderCount, 3);
  assert.equal(s.list.children.length, 3);
  assert.equal(s.observers.at(-1).observed.length, 4);
  assert.equal(s.render(false).renderCount, 1000);
  assert.equal(s.render(false).visibleCount, 1000);
});

test('empty data and a list shrink never render an out-of-range reserve', () => {
  const s = capacityFixture([120, 120, 120], 404);
  assert.equal(s.measureUntilStable().visibleCount, 3);
  assert.equal(s.render(true, ['0']).renderCount, 1);
  assert.equal(s.render(true, ['0']).visibleCount, 1);
  assert.equal(s.render(true, []).renderCount, 0);
  assert.equal(s.render(true, []).visibleCount, 0);
});

test('SavedAttempts renders the bounded home prefix with inert reserve and the full history', () => {
  const cards = Array.from({ length: 1000 }, (_, id) => ({
    attempt: { id: String(id) },
    content: {},
  }));
  const listRef = { current: null };
  const load = moduleLoader({
    '@/hooks/use-saved-attempts': { useSavedAttempts: () => ({ cards }) },
    '@/hooks/use-home-attempt-capacity': {
      useHomeAttemptCapacity: (enabled) => ({
        listRef,
        visibleCount: enabled ? 2 : cards.length,
        renderCount: enabled ? 3 : cards.length,
      }),
    },
  });
  const { SavedAttempts } = load('@/components/app/SavedAttempts');
  const { AttemptCard } = load('@/components/app/AttemptCard');
  for (const history of [false, true]) {
    const root = SavedAttempts({ history });
    const list = root.props.children.find((child) => child.props.ref === listRef);
    const rows = list.props.children;
    assert.equal(rows.length, history ? 1000 : 3);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.props.children.type, AttemptCard);
      assert.equal(row.props.children.props.attempt.id, String(index));
      assert.equal(row.props.inert, !history && index === 2);
      assert.equal(row.props['aria-hidden'], !history && index === 2 ? true : undefined);
    }
  }
});

test('stats and profile share one profile request on concurrent cold loads and after account invalidation', async () => {
  let profileRequests = 0;
  let statsRequests = 0;
  let profile = { goalId: 'high', levelId: 'basics' };
  const stats = { week: [{ minutes: 10 }, { minutes: 20 }], dailyProgressMinutes: 5 };
  const gate = deferred();
  let respond = () => gate.promise;
  const load = moduleLoader({
    '@/lib/api/profile': {
      fetchProfile: () => {
        profileRequests++;
        return respond();
      },
    },
    '@/lib/api/stats': {
      fetchStats: async () => {
        statsRequests++;
        return stats;
      },
    },
  });
  const { profileResource } = load('@/lib/profile-resource');
  const { userStatsResource, acceptStudyStats } = load('@/lib/user-stats-resource');
  const { setResourceOwner } = load('@/lib/cached-resource');
  const currentProfile = profileResource.get();
  const currentStats = userStatsResource.get();
  assert.equal(profileRequests, 1);
  assert.equal(statsRequests, 1);
  gate.resolve(profile);
  assert.deepEqual(await currentProfile, profile);
  assert.deepEqual(await currentStats, {
    ...stats,
    totalStudyMinutes: 30,
    goalId: 'high',
    levelId: 'basics',
  });
  await Promise.all([profileResource.get(), userStatsResource.get()]);
  assert.equal(profileRequests, 1);
  assert.equal(statsRequests, 1);
  acceptStudyStats({ ...stats, week: [{ minutes: 40 }], dailyProgressMinutes: 15 });
  assert.equal(userStatsResource.peek().totalStudyMinutes, 40);
  assert.equal(userStatsResource.peek().goalId, 'high');
  setResourceOwner('another-owner');
  profile = { goalId: 'good', levelId: 'advanced' };
  respond = async () => profile;
  const [nextProfile, nextStats] = await Promise.all([
    profileResource.get(),
    userStatsResource.get(),
  ]);
  assert.deepEqual(nextProfile, profile);
  assert.equal(nextStats.goalId, 'good');
  assert.equal(profileRequests, 2);
  assert.equal(statsRequests, 2);
});
