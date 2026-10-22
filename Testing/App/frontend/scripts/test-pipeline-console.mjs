import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, hookHarness, moduleLoader, settle } from './helpers/hook-harness.mjs';

const {
  PIPELINE_CONSOLE: CONFIG,
  PIPELINE_COPY: COPY,
  PIPELINE_ERROR_COPY,
  PIPELINE_PHASE_COPY,
  PIPELINE_OBSERVER_EVENTS,
} = await import('@/config/pipeline-console');
const { ApiError } = await import('@/lib/api/client');
const {
  pipelineEventCursor,
  mergePipelineEvents,
  mergePipelineRuns,
  pipelinePollMs,
  pipelineObserverStatus,
  pipelinePhaseLabel,
  pipelineEventTone,
  pipelineSubmissionUncertain,
  validatePipelineFile,
  pipelinePrivateUrl,
  pipelineEventDetails,
  pipelineEventLabel,
  groupPipelineEvents,
  pipelineErrorCode,
} = await import('@/lib/pipeline-console');
const { submitPipelineRun, fetchPipelineRun, fetchPipelineEvents, pipelineRequestError } =
  await import('@/lib/api/pipeline-console');

test('event cursor accepts gaps and stops at the last delivered event', () => {
  assert.equal(
    pipelineEventCursor({ items: [{ seq: 5 }, { seq: 9 }], nextAfter: 9, hasMore: true }, 2),
    9,
  );
  assert.equal(pipelineEventCursor({ items: [], nextAfter: 9, hasMore: false }, 9), 9);
  for (const page of [
    { items: [{ seq: 9 }], nextAfter: 10, hasMore: false },
    { items: [{ seq: 9 }, { seq: 7 }], nextAfter: 7, hasMore: false },
    { items: [], nextAfter: 2, hasMore: true },
    { items: [{ seq: 2 }], nextAfter: 2, hasMore: false },
  ])
    assert.throws(() => pipelineEventCursor(page, 2));
});

test('replayed events are deduplicated and the visible tail remains bounded', () => {
  const events = Array.from({ length: CONFIG.eventDisplayLimit + 20 }, (_, index) => ({
    seq: index + 1,
  }));
  const merged = mergePipelineEvents(events, [{ seq: 5 }, { seq: events.length + 1 }]);
  assert.equal(merged.length, CONFIG.eventDisplayLimit);
  assert.equal(merged.at(-1).seq, events.length + 1);
  assert.equal(new Set(merged.map((event) => event.seq)).size, merged.length);
});

test('run refresh updates existing entries without removing paginated history', () => {
  const old = { id: 'a', state: 'queued', createdAt: '2026-10-15' };
  const updated = { ...old, state: 'completed' };
  const historical = { id: 'b', state: 'completed', createdAt: '2026-10-14' };
  const recent = { id: 'c', state: 'running', createdAt: '2026-10-16' };
  assert.deepEqual(mergePipelineRuns([old, historical], [updated, recent]), [
    recent,
    updated,
    historical,
  ]);
});

test('late list pages cannot replace a newer run revision or timestamp', () => {
  const current = {
    id: 'run',
    state: 'returned',
    revision: 5,
    createdAt: '2026-10-16T10:00:00Z',
    updatedAt: '2026-10-16T11:00:00Z',
  };
  for (const stale of [
    { ...current, state: 'running', revision: 4 },
    { ...current, state: 'reviewing', updatedAt: '2026-10-16T10:30:00Z' },
  ])
    assert.deepEqual(mergePipelineRuns([current], [stale]), [current]);
  const next = { ...current, revision: 6 };
  assert.deepEqual(mergePipelineRuns([current], [next]), [next]);
});

test('polling stops on uncertain and terminal results, slows for expert review', () => {
  for (const state of CONFIG.terminal) {
    assert.equal(pipelinePollMs(state), null);
    assert.equal(pipelinePollMs(state, observer('pending')), CONFIG.activePollMs);
    for (const completion of ['finished', 'incomplete', 'not_started'])
      assert.equal(pipelinePollMs(state, observer(completion)), null);
  }
  assert.equal(pipelinePollMs('running'), CONFIG.activePollMs);
  assert.equal(pipelinePollMs('awaiting_expert'), CONFIG.idlePollMs);
  assert.equal(pipelinePollMs('reviewing'), CONFIG.idlePollMs);
});

function observer(state) {
  return { state, expiresAt: state === 'pending' ? '2026-10-16T15:00:00Z' : null };
}

test('observer contract rejects missing and unknown states instead of assuming completion', () => {
  for (const state of CONFIG.observerStates)
    assert.deepEqual(pipelineObserverStatus(observer(state)), observer(state));
  for (const invalid of [
    null,
    undefined,
    {},
    { state: 'completed', expiresAt: null },
    { state: 'constructor', expiresAt: null },
    { state: 'finished' },
    { state: 'pending', expiresAt: 'not a date' },
    { state: 'pending', expiresAt: 0 },
  ])
    assert.throws(() => pipelineObserverStatus(invalid), { message: COPY.errors.invalidEvents });
  assert.throws(() => pipelineEventCursor({ items: [], nextAfter: 0, hasMore: 'false' }, 0), {
    message: COPY.errors.invalidEvents,
  });
});

test('new server phases remain plain facts instead of invented completed stages', () => {
  assert.equal(pipelinePhaseLabel('geometry_artifact_ready', 'completed'), 'Проверка завершена');
  assert.equal(
    pipelineEventTone({
      type: 'stage_completed',
      phase: 'geometry_artifact_ready',
      state: 'completed',
    }),
    'muted',
  );
  assert.equal(
    pipelineEventTone({ type: 'graded', phase: 'ai_completed', state: 'completed' }),
    'success',
  );
  assert.deepEqual(
    pipelineEventDetails({
      seq: 12,
      type: 'artifact_ready',
      phase: 'geometry_artifact_ready',
      createdAt: '2026-10-16T10:00:00Z',
      data: { artifactId: 'a' },
    }),
    {
      artifactId: 'a',
      seq: 12,
      type: 'artifact_ready',
      phase: 'geometry_artifact_ready',
      createdAt: '2026-10-16T10:00:00Z',
    },
  );
});

function observedEvent(seq, type, phase = 'ocr') {
  return {
    seq,
    type,
    phase,
    state: 'running',
    createdAt: '2026-10-16T10:00:00Z',
    data: {},
  };
}

test('timeline groups delivered stage details while retaining generic backend facts and order', () => {
  const events = [
    observedEvent(1, 'upload_ready', 'media_processing'),
    observedEvent(2, 'queued', 'queued'),
    observedEvent(3, 'stage_started'),
    observedEvent(4, 'model_started'),
    observedEvent(5, 'model_completed'),
    observedEvent(6, 'validation_failed'),
    observedEvent(7, 'retry'),
    observedEvent(8, 'model_started'),
    observedEvent(9, 'model_completed'),
    observedEvent(10, 'stage_completed'),
    observedEvent(11, 'stage_started', 'analysis'),
    observedEvent(12, 'stage_completed', 'analysis'),
    observedEvent(13, 'graded', 'ai_completed'),
  ];
  const original = structuredClone(events);
  const timeline = groupPipelineEvents([...events].reverse());
  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.events[0].seq]),
    [
      ['event', 1],
      ['event', 2],
      ['stage', 3],
      ['stage', 11],
      ['event', 13],
    ],
  );
  assert.equal(timeline[2].summary.seq, 10);
  assert.equal(pipelineEventTone(timeline[2].summary), 'success');
  assert.deepEqual(
    timeline.flatMap((entry) => entry.events).sort((a, b) => a.seq - b.seq),
    events,
  );
  assert.deepEqual(events, original);
});

test('model completion and repaired validation errors never decide the stage status', () => {
  const events = [
    observedEvent(1, 'stage_started'),
    observedEvent(2, 'model_completed'),
    observedEvent(3, 'validation_failed'),
    observedEvent(4, 'retry'),
  ];
  const [stage] = groupPipelineEvents(events);
  assert.equal(stage.summary.type, 'stage_started');
  assert.equal(pipelineEventTone(stage.summary), 'active');
  assert.deepEqual(stage.events, events);

  events.push(observedEvent(5, 'stage_failed'));
  assert.equal(pipelineEventTone(groupPipelineEvents(events)[0].summary), 'failure');
  events.push(observedEvent(6, 'retry'));
  assert.equal(pipelineEventTone(groupPipelineEvents(events)[0].summary), 'failure');
  events.push(observedEvent(7, 'stage_started'), observedEvent(8, 'model_completed'));
  assert.equal(pipelineEventTone(groupPipelineEvents(events)[0].summary), 'active');
  events.push(observedEvent(9, 'stage_completed'));
  assert.equal(pipelineEventTone(groupPipelineEvents(events)[0].summary), 'success');
  assert.equal(groupPipelineEvents(events)[0].events.length, events.length);
});

test('timeline does not invent stages or move early artifacts into a stage that starts later', () => {
  const early = observedEvent(1, 'artifact_ready', 'validation');
  const events = [
    early,
    observedEvent(2, 'stage_started', 'analysis'),
    observedEvent(3, 'stage_completed', 'analysis'),
    observedEvent(4, 'stage_started', 'validation'),
    observedEvent(5, 'stage_completed', 'validation'),
  ];
  assert.deepEqual(groupPipelineEvents([early]), [
    { kind: 'event', summary: early, events: [early] },
  ]);
  assert.deepEqual(
    groupPipelineEvents(events).map((entry) => [entry.kind, entry.events[0].seq]),
    [
      ['event', 1],
      ['stage', 2],
      ['stage', 4],
    ],
  );
  assert.equal(groupPipelineEvents([observedEvent(1, 'model_started')])[0].kind, 'event');
  const [completed] = groupPipelineEvents([observedEvent(9, 'stage_completed')]);
  assert.equal(completed.events.length, 1);
  assert.equal(completed.summary.type, 'stage_completed');
  assert.deepEqual(groupPipelineEvents([]), []);
});

test('actual AI stages show their event outcome even while the overall run is running', () => {
  const event = { type: 'stage_completed', phase: 'ocr', state: 'running' };
  assert.equal(pipelineEventLabel(event), 'Распознавание решения · Этап завершён');
  assert.equal(pipelineEventTone(event), 'success');
  for (const phase of [
    'input',
    'preparation',
    'ocr',
    'layout',
    'diagrams',
    'analysis',
    'grading',
    'validation',
  ]) {
    assert.equal(pipelinePhaseLabel(phase, 'running'), PIPELINE_PHASE_COPY[phase]);
  }
  for (const [type, tone] of [
    ['stage_started', 'active'],
    ['model_started', 'active'],
    ['model_completed', 'muted'],
    ['model_failed', 'failure'],
    ['validation_failed', 'failure'],
    ['retry', 'active'],
    ['artifact_ready', 'muted'],
    ['stage_failed', 'failure'],
  ]) {
    assert.equal(pipelineEventTone({ ...event, type }), tone);
    assert.equal(
      pipelineEventLabel({ ...event, type }),
      COPY.event(PIPELINE_PHASE_COPY.ocr, PIPELINE_OBSERVER_EVENTS[type].label),
    );
  }
});

test('phase and error lookups ignore inherited object properties', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.equal(pipelinePhaseLabel(key, 'running'), 'ИИ проверяет');
    assert.equal(pipelineErrorCode(key), COPY.errors.run);
    assert.equal(
      pipelineEventTone({ type: 'stage_completed', phase: key, state: 'completed' }),
      'muted',
    );
    assert.equal(
      pipelineEventLabel({ type: key, phase: 'ocr', state: 'running' }),
      PIPELINE_PHASE_COPY.ocr,
    );
  }
});

test('run errors remain explicit without exposing service codes in the primary message', () => {
  assert.match(pipelineErrorCode('manual_input_unavailable'), /условием/);
  assert.match(pipelineErrorCode('unknown_backend_code'), /Оценка не выставлена/);
  assert.doesNotMatch(pipelineErrorCode('unknown_backend_code'), /unknown_backend_code/);
});

test('request errors expose only approved copy and local validation messages', () => {
  const internalMessage = 'Traceback: worker POST http://internal-ai:9000 failed at /srv/app.py:42';
  for (const cause of [
    new ApiError(500, internalMessage, 'unknown_backend_code'),
    new ApiError(500, internalMessage, 'constructor'),
    new ApiError(500, internalMessage),
    new Error(internalMessage),
    internalMessage,
  ]) {
    assert.equal(pipelineRequestError(cause), COPY.errors.load);
    assert.equal(pipelineRequestError(cause, COPY.errors.submit), COPY.errors.submit);
  }
  assert.equal(
    pipelineRequestError(new ApiError(503, internalMessage, 'grading_unavailable')),
    PIPELINE_ERROR_COPY.grading_unavailable,
  );
  assert.equal(
    pipelineRequestError(new Error(COPY.errors.invalidEvents)),
    COPY.errors.invalidEvents,
  );
  assert.equal(
    pipelineRequestError(new ApiError(500, COPY.errors.invalidEvents)),
    COPY.errors.load,
  );
});

test('known pre-dispatch failures do not imply an uncertain paid run', () => {
  assert.equal(pipelineSubmissionUncertain(503, 'manual_input_unavailable'), false);
  assert.equal(pipelineSubmissionUncertain(503, 'grading_unavailable'), false);
  assert.equal(pipelineSubmissionUncertain(429, 'queue_full'), false);
  assert.equal(pipelineSubmissionUncertain(502), true);
  assert.equal(pipelineSubmissionUncertain(), true);
});

test('manual file validation keeps PDFs and empty or oversized images out of the image-only endpoint', () => {
  assert.equal(validatePipelineFile({ type: 'image/jpeg', size: CONFIG.maxFileBytes }), null);
  assert.equal(validatePipelineFile({ type: 'image/png', size: 1 }), null);
  assert.ok(validatePipelineFile({ type: 'application/pdf', size: 1 }));
  assert.ok(validatePipelineFile({ type: 'image/png', size: 0 }));
  assert.ok(validatePipelineFile({ type: 'image/png', size: CONFIG.maxFileBytes + 1 }));
});

test('artifact links stay on private same-origin API paths', () => {
  assert.equal(
    pipelinePrivateUrl('/api/local-demo/runs/1/artifacts/2'),
    '/api/local-demo/runs/1/artifacts/2',
  );
  for (const url of [
    null,
    'https://example.com/private',
    '//example.com/private',
    'javascript:alert(1)',
    '/api/../public',
    '/api/\\evil',
  ])
    assert.equal(pipelinePrivateUrl(url), null);
});

test('manual submission preserves reference separation, image order and idempotency key', async (t) => {
  globalThis.document = { cookie: 'XSRF-TOKEN=csrf-token' };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: 'accepted-run' }), { status: 202 });
  });
  const task = new File(['reference'], 'task.png', { type: 'image/png' });
  const first = new File(['first'], 'one.png', { type: 'image/png' });
  const second = new File(['second'], 'two.jpg', { type: 'image/jpeg' });
  const input = { taskNumber: 16, taskImage: task, solutionImages: [first, second] };
  await submitPipelineRun(input, 'same-request');
  await submitPipelineRun(input, 'same-request');
  for (const { url, options } of requests) {
    assert.equal(url, '/api/local-demo/runs/manual');
    assert.equal(options.headers.get('Idempotency-Key'), 'same-request');
    assert.equal(options.headers.get('X-XSRF-TOKEN'), 'csrf-token');
    assert.equal(options.credentials, 'include');
    assert.equal(options.body.get('task_number'), '16');
    assert.equal(await options.body.get('task_image').text(), 'reference');
    assert.deepEqual(
      await Promise.all(options.body.getAll('solution_images').map((file) => file.text())),
      ['first', 'second'],
    );
    assert.deepEqual(
      [...options.body.keys()],
      ['task_number', 'task_image', 'solution_images', 'solution_images'],
    );
  }
});

test('event transport requests only the selected run after the delivered cursor', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, `/api/local-demo/runs/run-a/events?after=12&limit=${CONFIG.eventLimit}`);
    return new Response(
      JSON.stringify({ items: [], nextAfter: 12, hasMore: false, observer: observer('pending') }),
    );
  });
  await fetchPipelineEvents('run-a', 12);
});

test('run and event boundaries reject an absent observer before polling can stop', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ state: 'completed', items: [], nextAfter: 0, hasMore: false })),
  );
  await assert.rejects(fetchPipelineRun('run-a'), { message: COPY.errors.invalidEvents });
  await assert.rejects(fetchPipelineEvents('run-a', 0), { message: COPY.errors.invalidEvents });
});

function submissionHarness() {
  const hooks = hookHarness();
  const calls = [];
  const accepted = [];
  let keys = 0;
  const load = moduleLoader(
    {
      react: hooks.react,
      '@/lib/api/pipeline-console': {
        submitPipelineRun: (input, key) => {
          const result = deferred();
          calls.push({ input, key, result });
          return result.promise;
        },
        pipelineRequestError: (_cause, fallback) => fallback,
      },
    },
    { crypto: { randomUUID: () => `request-${++keys}` } },
  );
  const { usePipelineSubmission } = load('@/hooks/use-pipeline-submission');
  const onCreated = (run) => accepted.push(run);
  const render = () => hooks.render(() => usePipelineSubmission(onCreated));
  const initial = render();
  initial.addTask([new File(['condition'], 'task.png', { type: 'image/png' })]);
  initial.addSolutions([new File(['solution'], 'student.png', { type: 'image/png' })]);
  initial.close(true);
  return { hooks, render, calls, accepted };
}

test('an uncertain manual request retains both input sets and reuses its idempotency key', async () => {
  const flow = submissionHarness();
  let form = flow.render();
  const first = form.submit();
  await form.submit();
  assert.equal(flow.calls.length, 1);
  flow.calls[0].result.reject(new TypeError('Network unavailable'));
  await first;
  form = flow.render();
  assert.equal(form.uncertain, true);
  assert.equal(form.taskImage.name, 'task.png');
  assert.deepEqual(
    form.solutionImages.map((file) => file.name),
    ['student.png'],
  );
  const retry = form.submit();
  assert.equal(flow.calls[1].key, flow.calls[0].key);
  assert.equal(await flow.calls[1].input.taskImage.text(), 'condition');
  assert.equal(await flow.calls[1].input.solutionImages[0].text(), 'solution');
  flow.calls[1].result.resolve({ id: 'accepted' });
  await retry;
  form = flow.render();
  assert.equal(form.open, false);
  assert.equal(form.taskImage, null);
  assert.deepEqual(form.solutionImages, []);
  assert.deepEqual(flow.accepted, [{ id: 'accepted' }]);
  flow.hooks.unmount();
});

test('late manual submission results do not update a workspace after its session is closed', async () => {
  for (const reject of [false, true]) {
    const flow = submissionHarness();
    const pending = flow.render().submit();
    flow.hooks.unmount();
    if (reject) flow.calls[0].result.reject(new TypeError('Connection closed'));
    else flow.calls[0].result.resolve({ id: 'old-account-run' });
    await pending;
    assert.deepEqual(flow.accepted, []);
  }
});

function runHarness(initialState = 'running', options = {}) {
  const hooks = hookHarness();
  const timers = new Map();
  const listeners = new Map();
  const authErrors = [];
  const eventRequests = [];
  let timerId = 0;
  let runRequests = 0;
  let failure = null;
  const document = {
    hidden: false,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  const pages = options.pages ?? [
    {
      items: [observedEvent(1, 'stage_started')],
      nextAfter: 1,
      hasMore: true,
      observer: observer('finished'),
    },
    {
      items: [observedEvent(3, 'stage_completed')],
      nextAfter: 3,
      hasMore: false,
      observer: observer('finished'),
    },
  ];
  const load = moduleLoader(
    {
      react: hooks.react,
      '@/lib/api/pipeline-console': {
        fetchPipelineRun: async () => {
          runRequests++;
          if (failure) throw failure;
          return {
            id: 'run',
            state: initialState,
            observer: options.detailObserver ?? observer('finished'),
          };
        },
        fetchPipelineEvents: async (_id, after) => {
          eventRequests.push(after);
          return (
            pages.shift() ?? {
              items: [],
              nextAfter: after,
              hasMore: false,
              observer: observer('finished'),
            }
          );
        },
        pipelineRequestError: (_cause, fallback) => fallback,
      },
    },
    {
      document,
      setTimeout: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const onAuthError = (cause) => authErrors.push(cause);
  const { usePipelineRun } = load('@/hooks/use-pipeline-run');
  return {
    hooks,
    timers,
    document,
    listeners,
    eventRequests,
    authErrors,
    queuePages: (...incoming) => pages.push(...incoming),
    render: () => hooks.render(() => usePipelineRun('run', 0, onAuthError)),
    runRequests: () => runRequests,
    fail: (status) => {
      failure = new (load('@/lib/api/client').ApiError)(status, 'Internal service detail');
    },
    tick: async () => {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      await timer.callback();
      await settle();
    },
  };
}

test('run polling drains delivered pages then stops at a terminal result', async () => {
  const flow = runHarness('completed');
  flow.render();
  await settle();
  const view = flow.render();
  assert.deepEqual(flow.eventRequests, [0, 1]);
  assert.deepEqual(
    view.events.map((event) => event.seq),
    [1, 3],
  );
  assert.equal(flow.timers.size, 0);
  flow.listeners.get('visibilitychange')();
  await settle();
  assert.equal(flow.runRequests(), 1);
  flow.hooks.unmount();
});

test('terminal run keeps polling the last event observer and drains late final pages before stopping', async () => {
  const flow = runHarness('completed', {
    detailObserver: observer('finished'),
    pages: [
      {
        items: [observedEvent(1, 'stage_started')],
        nextAfter: 1,
        hasMore: false,
        observer: observer('pending'),
      },
    ],
  });
  flow.render();
  await settle();
  assert.equal(flow.render().detail.observer.state, 'pending');
  assert.equal([...flow.timers.values()][0].delay, CONFIG.activePollMs);

  flow.queuePages({ items: [], nextAfter: 1, hasMore: false, observer: observer('pending') });
  await flow.tick();
  assert.equal(flow.timers.size, 1);

  flow.queuePages(
    {
      items: [observedEvent(2, 'stage_completed')],
      nextAfter: 2,
      hasMore: true,
      observer: observer('finished'),
    },
    {
      items: [observedEvent(4, 'completed', 'validation')],
      nextAfter: 4,
      hasMore: false,
      observer: observer('finished'),
    },
  );
  await flow.tick();
  const view = flow.render();
  assert.deepEqual(flow.eventRequests, [0, 1, 1, 2]);
  assert.deepEqual(
    view.events.map((event) => event.seq),
    [1, 2, 4],
  );
  assert.equal(view.detail.observer.state, 'finished');
  assert.equal(flow.timers.size, 0);
  flow.listeners.get('visibilitychange')();
  await settle();
  assert.equal(flow.runRequests(), 3);
  flow.hooks.unmount();
});

test('terminal observer incomplete and not_started stop only after available event pages are read', async () => {
  for (const state of ['incomplete', 'not_started']) {
    const flow = runHarness('failed', {
      detailObserver: observer('pending'),
      pages: [
        {
          items: [observedEvent(1, 'stage_started')],
          nextAfter: 1,
          hasMore: true,
          observer: observer(state),
        },
        {
          items: [observedEvent(2, 'stage_failed')],
          nextAfter: 2,
          hasMore: false,
          observer: observer(state),
        },
      ],
    });
    flow.render();
    await settle();
    const view = flow.render();
    assert.deepEqual(flow.eventRequests, [0, 1]);
    assert.equal(view.events.length, 2);
    assert.equal(view.detail.observer.state, state);
    assert.equal(flow.timers.size, 0);
    flow.hooks.unmount();
  }
});

test('access loss clears previous results while a temporary server error retains them as stale', async () => {
  for (const status of [401, 403, 404, 503]) {
    const flow = runHarness();
    flow.render();
    await settle();
    assert.equal(flow.render().detail.id, 'run');
    flow.fail(status);
    await flow.tick();
    const view = flow.render();
    assert.equal(view.error, COPY.errors.load);
    if (status === 503) {
      assert.equal(view.detail.id, 'run');
      assert.equal(view.events.length, 2);
      assert.equal([...flow.timers.values()][0].delay, CONFIG.reconnectPollMs);
    } else {
      assert.equal(view.detail, null);
      assert.deepEqual(view.events, []);
      assert.equal(flow.timers.size, 0);
      assert.equal(flow.authErrors.length, status === 404 ? 0 : 1);
    }
    flow.hooks.unmount();
  }
});

test('failure diagnostics use actual phase and attempt without inventing missing evidence', async () => {
  const { pipelineFailureLabel, pipelineAttemptLabel } = await import('@/lib/pipeline-console');
  const failure = {
    category: 'network',
    diagnosticCode: 401,
    reasonCode: 'connection_reset',
    phase: 'analysis',
    step: 'analysis_review',
    attempt: 4,
    maxAttempts: 4,
    failureCounts: { network: 2, model_response: 1, timeout: 1 },
    exhausted: true,
  };
  assert.equal(pipelineFailureLabel(failure), 'Ошибка связи · Анализ решения · Попытка 4/4');
  assert.equal(pipelineFailureLabel(null), '');
  assert.equal(
    pipelineFailureLabel({ category: 'model_response', phase: 'ocr' }),
    'Некорректный ответ ИИ · Распознавание решения',
  );
  for (const pair of [
    [0, 4],
    [5, 4],
    [1, undefined],
    ['2', 4],
    [1.5, 4],
  ])
    assert.equal(pipelineAttemptLabel(...pair), '');
  assert.equal(pipelineFailureLabel({ category: 'constructor', phase: 'constructor' }), '');
});

test('retry labels use the next attempt and retain diagnostic fields verbatim', async () => {
  const { pipelineEventAction } = await import('@/lib/pipeline-console');
  const retry = {
    ...observedEvent(2, 'retry', 'analysis'),
    data: {
      failure_category: 'model_response',
      diagnostic_code: 601,
      reason_code: 'invalid_json',
      step: 'analysis_review',
      attempt: 2,
      max_attempts: 4,
      issue_codes: ['invalid_json'],
      issue_paths: ['$.analysis'],
    },
  };
  assert.equal(
    pipelineEventAction(retry),
    'Повторная попытка · Некорректный ответ ИИ · Попытка 2/4',
  );
  assert.equal(pipelineEventDetails(retry).step, 'analysis_review');
  assert.equal(pipelineEventDetails(retry).diagnostic_code, 601);
  const events = [
    observedEvent(1, 'stage_started', 'analysis'),
    retry,
    observedEvent(3, 'stage_completed', 'analysis'),
  ];
  assert.equal(pipelineEventTone(groupPipelineEvents(events)[0].summary), 'success');
  assert.equal(pipelineEventAction(observedEvent(4, 'retry')), 'Повторная попытка');
});

test('backend safeData camelCase events show attempts and failure groups without losing stored diagnostics', async () => {
  const { pipelineEventAction } = await import('@/lib/pipeline-console');
  // LocalDemoEvents.safeData persists these names and page() returns the stored data unchanged.
  const event = {
    ...observedEvent(3, 'retry', 'analysis'),
    data: {
      attempt: 2,
      maxAttempts: 4,
      failureCategory: 'model_response',
      diagnosticCode: 607,
      reasonCode: 'invalid_stage_response',
      phase: 'analysis',
      step: 'analysis',
      failureCounts: { model_response: 1 },
      retryable: true,
      exhausted: false,
      issueCodes: ['invalid_stage_response'],
      issuePaths: ['$.analysis'],
      durationMs: 1250,
    },
  };
  assert.equal(
    pipelineEventAction(event),
    'Повторная попытка · Некорректный ответ ИИ · Попытка 2/4',
  );
  assert.equal(
    pipelineEventLabel(event),
    'Анализ решения · Повторная попытка · Некорректный ответ ИИ · Попытка 2/4',
  );
  assert.equal(pipelineEventDetails(event).diagnosticCode, 607);
  assert.deepEqual(pipelineEventDetails(event).failureCounts, { model_response: 1 });
});
