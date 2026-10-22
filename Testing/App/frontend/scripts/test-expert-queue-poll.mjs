import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, hookHarness, moduleLoader, settle } from './helpers/hook-harness.mjs';

const liveSession = {
  id: 'expert',
  mode: 'live',
  name: 'Эксперт',
  email: 'expert@example.test',
  initials: 'Э',
};

function queueHarness(session = liveSession) {
  const harness = hookHarness();
  const timers = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const calls = [];
  let timerId = 0;
  let response;
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, listener) => documentEvents.set(name, listener),
    removeEventListener: (name) => documentEvents.delete(name),
  };
  const load = moduleLoader(
    {
      react: harness.react,
      '@/lib/api/expert': {
        fetchExpertWorkspace: async (owner) => {
          calls.push(owner);
          return response();
        },
      },
    },
    {
      document,
      window: {
        addEventListener: (name, listener) => windowEvents.set(name, listener),
        removeEventListener: (name) => windowEvents.delete(name),
      },
      setTimeout: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const { EXPERT_MOCK_TASKS } = load('@/config/expert-mock');
  const { EXPERT, EXPERT_COPY } = load('@/config/expert');
  const { ApiError } = load('@/lib/api/client');
  const { useExpertStore } = load('@/stores/expert-store');
  const { useExpertQueuePoll } = load('@/hooks/use-expert-queue-poll');
  const student = { id: 'student', name: 'Ученик', initials: 'У', email: '', contact: '' };
  const workspace = {
    students: [student],
    works: [
      {
        id: 'work',
        studentId: student.id,
        student,
        subject: 'Математика',
        submittedAt: '',
        submittedAgoMinutes: 1,
        status: 'pending',
        tasks: structuredClone(EXPERT_MOCK_TASKS),
      },
    ],
  };
  response = async () => structuredClone(workspace);
  useExpertStore.getState().setSession(session);
  useExpertStore.getState().setWorkspace(structuredClone(workspace));
  useExpertStore.getState().setLoading(false);

  return {
    render: () => harness.render(() => useExpertQueuePoll(useExpertStore.getState().session)),
    store: useExpertStore.getState,
    workspace,
    calls,
    timers,
    document,
    copy: EXPERT_COPY,
    pollMs: EXPERT.queuePollMs,
    apiError: (status) => new ApiError(status, 'Ошибка сервера'),
    focus: () => windowEvents.get('focus')?.(),
    visibility: (state) => {
      document.visibilityState = state;
      documentEvents.get('visibilitychange')?.();
    },
    respond: (callback) => {
      response = callback;
    },
    tick: async () => {
      const [id, { callback }] = timers.entries().next().value;
      timers.delete(id);
      callback();
      await settle();
    },
    unmount: () => {
      harness.unmount();
      assert.equal(timers.size, 0);
      assert.equal(documentEvents.size, 0);
      assert.equal(windowEvents.size, 0);
    },
  };
}

function withNewWork(workspace, status = 'pending') {
  return {
    ...structuredClone(workspace),
    works: [
      ...structuredClone(workspace.works),
      { ...structuredClone(workspace.works[0]), id: 'new-work', status },
    ],
  };
}

test('live queue refresh adds and announces a pending work while preserving drafts, task selection and filters', async () => {
  const flow = queueHarness();
  flow.render();
  assert.equal(flow.calls.length, 0);
  assert.equal([...flow.timers.values()][0].delay, flow.pollMs);
  const task = flow.workspace.works[0].tasks[1];
  flow.store().openWork('work');
  flow.store().selectTask(task.id);
  flow.store().setQuery('Ученик');
  flow.store().setSort('newest');
  flow.store().setFilter('reviewed');
  flow.store().updateBlock({ ...task.blocks[0], explanation: 'Локальная правка' });
  const draft = flow.store().drafts[task.id];
  flow.respond(async () => withNewWork(flow.workspace));
  await flow.tick();

  assert.equal(flow.store().works.length, 2);
  assert.equal(flow.store().drafts[task.id], draft);
  assert.equal(flow.store().selectedWorkId, 'work');
  assert.equal(flow.store().selectedTaskId, task.id);
  assert.equal(flow.store().view, 'review');
  assert.equal(flow.store().query, 'Ученик');
  assert.equal(flow.store().sort, 'newest');
  assert.equal(flow.store().filter, 'reviewed');
  assert.equal(flow.store().feedback, flow.copy.newWorkReady);
  flow.store().setFeedback(null);
  await flow.tick();
  assert.equal(flow.store().feedback, null);
  flow.unmount();
});

test('polling is live-only, pauses while hidden and refreshes once on focus without overlapping requests', async () => {
  for (const session of [null, { ...liveSession, mode: 'demo' }]) {
    const inactive = queueHarness(session);
    inactive.render();
    assert.equal(inactive.timers.size, 0);
    inactive.focus();
    assert.equal(inactive.calls.length, 0);
    inactive.unmount();
  }
  const flow = queueHarness();
  flow.render();
  flow.visibility('hidden');
  assert.equal(flow.timers.size, 0);
  flow.focus();
  assert.equal(flow.calls.length, 0);
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.visibility('visible');
  flow.focus();
  await flow.tick();
  assert.equal(flow.calls.length, 1);
  pending.resolve(flow.workspace);
  await settle();
  assert.equal(flow.timers.size, 1);
  flow.unmount();
});

test('a late queue response cannot replace a saved or graded work or erase its feedback', async () => {
  const flow = queueHarness();
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.render();
  await flow.tick();
  flow.store().setBusy(true);
  const saved = structuredClone(flow.workspace.works[0]);
  saved.tasks[0].revision += 1;
  saved.tasks[0].approved = true;
  flow.store().acceptWork(saved, [saved.tasks[0].id]);
  flow.store().setFeedback(flow.copy.approvedTask);
  flow.store().setBusy(false);
  pending.resolve(withNewWork(flow.workspace));
  await settle();

  assert.equal(flow.store().works[0], saved);
  assert.equal(flow.store().works.length, 1);
  assert.equal(flow.store().feedback, flow.copy.approvedTask);
  flow.unmount();
});

test('busy and loading transitions invalidate an in-flight response even when values return to false', async () => {
  for (const action of ['setBusy', 'setLoading']) {
    const flow = queueHarness();
    const pending = deferred();
    flow.respond(() => pending.promise);
    flow.render();
    flow.store()[action](true);
    await flow.tick();
    assert.equal(flow.calls.length, 0);
    flow.store()[action](false);
    await flow.tick();
    flow.store()[action](true);
    flow.store()[action](false);
    pending.resolve(withNewWork(flow.workspace));
    await settle();
    assert.equal(flow.store().works.length, 1);
    assert.equal(flow.store().feedback, null);
    flow.unmount();
  }
});

test('a stale server revision is never accepted even when no local operation ran during the request', async () => {
  const flow = queueHarness();
  const current = structuredClone(flow.workspace.works[0]);
  current.tasks[0].revision += 1;
  flow.store().acceptWork(current, []);
  flow.respond(async () => withNewWork(flow.workspace));
  flow.render();
  await flow.tick();
  assert.equal(flow.store().works[0], current);
  assert.equal(flow.store().works.length, 1);
  flow.unmount();
});

test('session changes invalidate old responses and keep one request active across effect cleanup', async () => {
  const flow = queueHarness();
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.render();
  await flow.tick();
  flow.store().setSession({ ...liveSession, id: 'other-expert' });
  flow.render();
  flow.focus();
  assert.equal(flow.calls.length, 1);
  pending.resolve(withNewWork(flow.workspace));
  await settle();
  assert.equal(flow.store().works.length, 0);
  assert.equal(flow.store().feedback, null);
  flow.respond(async () => ({ students: [], works: [] }));
  await flow.tick();
  assert.equal(flow.calls[1].id, 'other-expert');
  flow.unmount();
});

test('logout and reauthentication as the same expert invalidate an old request before a rerender', async () => {
  const flow = queueHarness();
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.render();
  await flow.tick();
  const originalSession = flow.store().session;
  flow.store().setSession(null);
  flow.store().setSession(originalSession);
  pending.resolve(withNewWork(flow.workspace));
  await settle();
  assert.equal(flow.store().works.length, 1);
  assert.equal(flow.store().feedback, null);
  flow.unmount();
});

test('edits and navigation made while reading the queue are retained when the response arrives', async () => {
  const flow = queueHarness();
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.render();
  await flow.tick();
  const task = flow.workspace.works[0].tasks[1];
  flow.store().openWork('work');
  flow.store().selectTask(task.id);
  flow.store().updateAnalysis({ advice: 'Новая локальная правка во время запроса' });
  flow.store().setQuery('Петя');
  const draft = flow.store().drafts[task.id];
  pending.resolve(withNewWork(flow.workspace));
  await settle();
  assert.equal(flow.store().works.length, 2);
  assert.equal(flow.store().drafts[task.id], draft);
  assert.equal(flow.store().selectedTaskId, task.id);
  assert.equal(flow.store().query, 'Петя');
  flow.unmount();
});

test('network errors preserve edits and messages, retry silently and never announce reviewed-only work', async () => {
  const flow = queueHarness();
  flow.store().openWork('work');
  flow.store().updateAnalysis({ advice: 'Сохрани мою правку' });
  flow.store().setError('Ошибка ручного действия');
  flow.store().setFeedback('Предыдущее уведомление');
  const before = flow.store();
  flow.respond(async () => {
    throw new TypeError('Offline');
  });
  flow.render();
  await flow.tick();
  assert.equal(flow.store().works, before.works);
  assert.equal(flow.store().drafts, before.drafts);
  assert.equal(flow.store().error, before.error);
  assert.equal(flow.store().feedback, before.feedback);
  flow.respond(async () => withNewWork(flow.workspace, 'reviewed'));
  await flow.tick();
  assert.equal(flow.store().works.length, 2);
  assert.equal(flow.store().feedback, before.feedback);
  flow.unmount();
});

test('unmount or hiding the page while fetching prevents a response from changing the workspace', async () => {
  for (const deactivate of [(flow) => flow.unmount(), (flow) => flow.visibility('hidden')]) {
    const flow = queueHarness();
    const pending = deferred();
    flow.respond(() => pending.promise);
    flow.render();
    await flow.tick();
    const before = flow.store().works;
    deactivate(flow);
    pending.resolve(withNewWork(flow.workspace));
    await settle();
    assert.equal(flow.store().works, before);
    assert.equal(flow.timers.size, 0);
    flow.unmount();
  }
});

test('current authentication failures hide the workspace, stop polling and preserve drafts for the same owner', async () => {
  for (const status of [401, 403]) {
    const flow = queueHarness();
    flow.store().openWork('work');
    flow.store().updateAnalysis({ advice: 'Локальный черновик' });
    const drafts = flow.store().drafts;
    const owner = flow.store().sessionOwner;
    flow.respond(async () => {
      throw flow.apiError(status);
    });
    flow.render();
    await flow.tick();

    assert.equal(flow.store().session, null);
    assert.equal(flow.store().sessionOwner, owner);
    assert.equal(flow.store().drafts, drafts);
    assert.equal(
      flow.store().error,
      status === 401 ? flow.copy.errors.session : flow.copy.errors.role,
    );
    assert.equal(flow.timers.size, 0);
    flow.focus();
    assert.equal(flow.calls.length, 1);
    flow.store().setSession({ ...liveSession });
    assert.equal(flow.store().drafts, drafts);
    flow.store().setSession({ ...liveSession, id: 'another-expert' });
    assert.deepEqual(flow.store().drafts, {});
    flow.unmount();
  }
});

test('an authentication failure from an old session or mutation generation cannot log out the current expert', async () => {
  for (const invalidate of [
    (flow) => flow.store().setSession({ ...liveSession, id: 'new-expert' }),
    (flow) => {
      flow.store().setSession(null);
      flow.store().setSession(liveSession);
    },
    (flow) => {
      flow.store().setBusy(true);
      flow.store().setBusy(false);
    },
  ]) {
    const flow = queueHarness();
    const pending = deferred();
    flow.respond(() => pending.promise);
    flow.render();
    await flow.tick();
    invalidate(flow);
    const currentSession = flow.store().session;
    pending.reject(flow.apiError(401));
    await settle();
    assert.equal(flow.store().session, currentSession);
    assert.equal(flow.store().error, null);
    flow.unmount();
  }
});

test('access loss hides the workspace even if its request finishes after the page becomes hidden', async () => {
  const flow = queueHarness();
  const pending = deferred();
  flow.respond(() => pending.promise);
  flow.render();
  await flow.tick();
  flow.visibility('hidden');
  pending.reject(flow.apiError(403));
  await settle();
  assert.equal(flow.store().session, null);
  assert.equal(flow.store().error, flow.copy.errors.role);
  assert.equal(flow.timers.size, 0);
  flow.unmount();
});

test('a detail not-found or server failure is not proof of session loss and remains a silent retry', async () => {
  for (const status of [404, 500, 503]) {
    const flow = queueHarness();
    flow.store().setError('Сохрани существующую ошибку');
    const session = flow.store().session;
    const works = flow.store().works;
    flow.respond(async () => {
      throw flow.apiError(status);
    });
    flow.render();
    await flow.tick();
    assert.equal(flow.store().session, session);
    assert.equal(flow.store().works, works);
    assert.equal(flow.store().error, 'Сохрани существующую ошибку');
    assert.equal(flow.timers.size, 1);
    flow.unmount();
  }
});

function gradePollHarness(initialState = 'queued') {
  const hooks = hookHarness();
  const timers = new Map();
  const feedback = [];
  const errors = [];
  const accepted = [];
  let timerId = 0;
  let response;
  const task = { revision: 2, gradingJob: { id: 'job', state: initialState } };
  const store = {
    works: [{ id: 'work', tasks: [task] }],
    acceptWork: (work) => {
      accepted.push(work);
      store.works = [work];
    },
    setFeedback: (value) => feedback.push(value),
    setError: (value) => errors.push(value),
  };
  const load = moduleLoader(
    {
      react: hooks.react,
      '@/stores/expert-store': { useExpertStore: { getState: () => store } },
      '@/lib/api/expert': {
        fetchExpertGradeJob: async () => response(),
        expertErrorMessage: (cause) => cause.message,
      },
    },
    {
      setTimeout: (callback) => {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const { useExpertGradePoll } = load('@/hooks/use-expert-grade-poll');
  hooks.render(() => useExpertGradePoll(liveSession, 'work', task));
  return {
    hooks,
    timers,
    feedback,
    errors,
    accepted,
    load,
    respond: (value) => {
      response = () => value;
    },
    reject: (cause) => {
      response = () => {
        throw cause;
      };
    },
    tick: async () => {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      await callback();
      await settle();
    },
  };
}

test('queued grade-only work polls through execution to completion without another grade request', async () => {
  const flow = gradePollHarness();
  const copy = flow.load('@/config/expert').EXPERT_COPY;
  assert.equal(flow.timers.size, 1);
  for (const state of ['queued', 'pending', 'succeeded']) {
    flow.respond({ id: 'work', tasks: [{ revision: 3, gradingJob: { id: 'job', state } }] });
    await flow.tick();
  }
  assert.deepEqual(flow.feedback, [copy.gradeQueued, copy.gradePending, copy.graded]);
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.accepted.length, 3);
  assert.equal(flow.timers.size, 0);
  flow.hooks.unmount();
});

test('temporary polling failure leaves queued job waiting and resumes read-only polling', async () => {
  const flow = gradePollHarness();
  flow.reject(new TypeError('connection interrupted'));
  await flow.tick();
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.feedback.at(-1), flow.load('@/config/expert').EXPERT_COPY.gradeConnection);
  assert.equal(flow.timers.size, 1);
  flow.respond({
    id: 'work',
    tasks: [{ revision: 3, gradingJob: { id: 'job', state: 'succeeded' } }],
  });
  await flow.tick();
  assert.equal(flow.timers.size, 0);
  flow.hooks.unmount();
});

test('access loss stops grade polling', async () => {
  const flow = gradePollHarness();
  const { ApiError } = flow.load('@/lib/api/client');
  flow.reject(new ApiError(403, 'no access'));
  await flow.tick();
  assert.equal(flow.timers.size, 0);
  assert.equal(flow.errors.length, 1);
  flow.hooks.unmount();
});

test('late grade polling response cannot update a closed expert session', async () => {
  const flow = gradePollHarness();
  const response = deferred();
  flow.respond(response.promise);
  const pending = flow.tick();
  flow.hooks.unmount();
  response.resolve({
    id: 'work',
    tasks: [{ revision: 3, gradingJob: { id: 'job', state: 'succeeded' } }],
  });
  await pending;
  assert.deepEqual(flow.accepted, []);
  assert.deepEqual(flow.feedback, []);
  assert.equal(flow.timers.size, 0);
});

test('grade-only terminal failures retain diagnostic category without exposing technical codes', async () => {
  const failure = {
    category: 'network',
    diagnosticCode: 401,
    reasonCode: 'provider_connection_error',
    phase: 'grading',
    step: 'grading.expert',
    attempt: 4,
    maxAttempts: 4,
  };
  for (const state of ['failed', 'unknown']) {
    const flow = gradePollHarness();
    flow.respond({
      id: 'work',
      tasks: [{ revision: 3, gradingJob: { id: 'job', state, failure } }],
    });
    await flow.tick();
    const message = state === 'failed' ? flow.errors.at(-1) : flow.feedback.at(-1);
    assert.match(message, /Ошибка связи/);
    assert.match(message, /Выставление оценки/);
    assert.match(message, /Попытка 4\/4/);
    assert.doesNotMatch(message, /provider_connection_error|401/);
    assert.deepEqual(flow.accepted[0].tasks[0].gradingJob.failure, failure);
    assert.equal(flow.timers.size, 0);
    flow.hooks.unmount();
  }
});
