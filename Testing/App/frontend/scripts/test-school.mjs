import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  moduleLoader,
  hookHarness,
  memoryStore,
  deferred,
  settle,
} from './helpers/hook-harness.mjs';

const identity = {
  id: 'student',
  email: 'student@example.test',
  displayName: 'Ученик',
  schools: [{ id: 'school', name: 'Школа' }],
  taskNumbers: [14, 16, 17, 18],
};
const canonical = {
  schema_version: 'expert-review.v1',
  origin: 'expert',
  phase: 'graded',
  solution_image_ids: [],
  ocr: { blocks: [] },
  analysis: {
    block_reviews: [],
    findings: [],
    summary: null,
    checks: null,
    student_answer: null,
    strengths: [],
  },
  grading: { score: 1, criterion: 'Критерий', explanation: 'Проверено' },
  rejection_reason: null,
};
const assignment = () => ({
  id: 'assignment',
  school: { id: 'school', name: 'Школа' },
  title: 'Задание',
  taskNumber: 16,
  maxScore: 2,
  assignedAt: '2026-10-16T10:00:00Z',
  dueAt: null,
  status: 'not_started',
  submissionId: null,
  updatedAt: '2026-10-16T10:00:00Z',
  submission: null,
  task: { taskNumber: 16, maxScore: 2, statement: 'Условие', content: [] },
});
const submission = (patch = {}) => ({
  id: 'submission',
  assignmentId: 'assignment',
  origin: 'school',
  revision: 1,
  status: 'draft',
  images: [],
  documents: [],
  createdAt: '2026-10-16T10:00:00Z',
  updatedAt: '2026-10-16T10:00:00Z',
  errorCode: null,
  retryable: false,
  expertReview: null,
  result: null,
  imageArtifacts: [],
  ...patch,
});
const photo = (id = 'image') => ({
  id,
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 10,
  status: 'ready',
  previewUrl: `/api/media/${id}`,
});

test('school transport rejects provisional results and requires a sent final snapshot', () => {
  const { schoolSubmission } = moduleLoader()('@/lib/api/school');
  assert.equal(schoolSubmission(submission()).result, null);
  assert.throws(() =>
    schoolSubmission(submission({ status: 'awaiting_expert', result: canonical })),
  );
  assert.throws(() =>
    schoolSubmission(
      submission({
        status: 'returned',
        result: canonical,
        expertReview: { status: 'draft', sentAt: null },
      }),
    ),
  );
  assert.throws(() => schoolSubmission(submission({ status: 'returned' })));
  const sent = submission({
    status: 'returned',
    result: canonical,
    expertReview: { status: 'sent', sentAt: '2026-10-16T11:00:00Z' },
  });
  assert.deepEqual(schoolSubmission(sent).result, canonical);
});

test('student final renders the sent geometry crop and no reference or provisional content', () => {
  const load = moduleLoader({
    'next/image': {
      default: ({ src, alt, width, height }) => createElement('img', { src, alt, width, height }),
    },
  });
  const { SchoolResult } = load('@/components/school/SchoolResult');
  const { schoolSubmission } = load('@/lib/api/school');
  const result = {
    ...canonical,
    schema_version: 'expert-review.v2',
    ocr: {
      blocks: [
        {
          id: 'geometry-step',
          title: 'Чертёж ученика',
          sources: [],
          content: {
            type: 'step',
            lines: ['Проведём высоту'],
            image: { type: 'image', artifact_id: 'crop', alt: 'Высота треугольника' },
          },
        },
      ],
    },
    analysis: {
      ...canonical.analysis,
      block_reviews: [
        {
          block_id: 'geometry-step',
          status: 'correct',
          explanation: 'Построение верное',
          follows_from_block_ids: [],
        },
      ],
    },
  };
  const sent = schoolSubmission(
    submission({
      status: 'returned',
      expertReview: { status: 'sent', sentAt: '2026-10-16T11:00:00Z' },
      result,
      imageArtifacts: [
        {
          id: 'crop',
          mimeType: 'image/jpeg',
          previewUrl: '/api/submissions/submission/image-artifacts/crop/preview',
          width: 640,
          height: 480,
        },
        {
          id: 'unreferenced',
          mimeType: 'image/jpeg',
          previewUrl: '/api/unreferenced-artifact',
          width: 640,
          height: 480,
        },
      ],
      referenceAnswer: 'Скрытый эталон',
      referenceSolution: 'Скрытое решение',
    }),
  );
  const render = (value) =>
    renderToStaticMarkup(createElement(SchoolResult, { submission: value, maxScore: 2 }));
  const html = render(sent);
  assert.match(html, /Проведём высоту/);
  assert.match(html, /Высота треугольника/);
  assert.match(html, /\/api\/submissions\/submission\/image-artifacts\/crop\/preview/);
  assert.doesNotMatch(html, /Скрытый эталон|Скрытое решение|unreferenced-artifact/);
  assert.equal(render({ ...sent, status: 'awaiting_expert' }), '');
  assert.equal(render({ ...sent, expertReview: { status: 'draft', sentAt: null } }), '');
});

test('school errors show useful product copy without backend internals', () => {
  const load = moduleLoader();
  const { schoolErrorMessage } = load('@/lib/api/school');
  const { ApiError } = load('@/lib/api/client');
  const { SCHOOL_COPY } = load('@/config/school');
  assert.equal(
    schoolErrorMessage(new ApiError(503, 'local demo mock seed', 'grading_unavailable')),
    SCHOOL_COPY.checkingUnavailable,
  );
  assert.equal(schoolErrorMessage(new ApiError(500, 'JSON transport error')), SCHOOL_COPY.error);
  assert.equal(
    schoolErrorMessage(new SyntaxError('Unexpected token in internal response')),
    SCHOOL_COPY.error,
  );
  assert.equal(
    schoolErrorMessage(new ApiError(500, 'Internal error', 'constructor')),
    SCHOOL_COPY.error,
  );
  assert.equal(
    schoolErrorMessage(new Error(SCHOOL_COPY.filesRemaining)),
    SCHOOL_COPY.filesRemaining,
  );
  assert.equal(
    schoolErrorMessage(new ApiError(409, 'revision mismatch', 'revision_conflict')),
    SCHOOL_COPY.conflict,
  );
  assert.equal(
    schoolErrorMessage(new ApiError(401, 'session_required')),
    SCHOOL_COPY.sessionExpired,
  );
});

test('PDF state gates submission; polling stops at final and failed states', () => {
  const { schoolSendDisabled, schoolPollDelay, schoolCanRetry } = moduleLoader()('@/lib/school');
  assert.ok(schoolSendDisabled(submission(), false));
  assert.equal(schoolSendDisabled(submission({ images: [photo()] }), false), null);
  for (const state of ['processing', 'failed']) {
    assert.ok(schoolSendDisabled(submission({ images: [photo()], documents: [{ state }] }), false));
  }
  assert.equal(schoolPollDelay(submission({ documents: [{ state: 'processing' }] })), 2000);
  assert.equal(schoolPollDelay(submission({ status: 'running' })), 2000);
  assert.equal(schoolPollDelay(submission({ status: 'reviewing' })), 5000);
  for (const status of ['returned', 'failed', 'cancelled', 'expired']) {
    assert.equal(schoolPollDelay(submission({ status })), null);
    assert.equal(
      schoolPollDelay(submission({ status, documents: [{ state: 'processing' }] })),
      null,
    );
  }
  assert.equal(schoolCanRetry(submission({ status: 'returned', retryable: true })), false);
  assert.equal(schoolCanRetry(submission({ status: 'failed', retryable: true })), true);
});

function uploadFlow(initial = null) {
  const hooks = hookHarness();
  let server = initial;
  let counter = 0;
  let uploadFailure;
  let createFailure;
  let finalizeFailure;
  let cancelFailure;
  const cancelled = [];
  let refreshes = 0;
  const fixtures = [];
  const created = [],
    uploaded = [],
    finalized = [];
  const load = moduleLoader(
    {
      react: hooks.react,
      zustand: { create: memoryStore() },
      '@/lib/image-validation': { imageRejection: async () => null },
      '@/lib/api/school': {
        schoolErrorMessage: (cause) => cause.message,
        attachSchoolFixture: async (assignmentId, submissionId) => {
          fixtures.push({ assignmentId, submissionId });
          server.images = [photo('fixture')];
          server.revision++;
          return structuredClone(server);
        },
        createSchoolSubmission: async (id, key, retryOfId) => {
          created.push({ id, key, retryOfId });
          server ??= submission();
          if (server.status === 'cancelled')
            server = submission({ id: 'replacement', createdAt: '2026-10-22T10:00:00Z' });
          if (createFailure) throw createFailure;
          return structuredClone(server);
        },
        fetchSchoolSubmission: async () => {
          refreshes++;
          return structuredClone(server);
        },
        fetchSchoolAssignment: async () => ({
          ...assignment(),
          submission: structuredClone(server),
          status: server.status,
        }),
        cancelSchoolSubmission: async (id) => {
          cancelled.push(id);
          if (cancelFailure) throw cancelFailure;
          server = { ...server, status: 'cancelled', retryable: true };
          return structuredClone(server);
        },
        finalizeSchoolSubmission: async (id, revision) => {
          finalized.push({ id, revision });
          if (finalizeFailure) throw finalizeFailure;
          server = { ...server, revision: server.revision + 1, status: 'queued' };
          return structuredClone(server);
        },
      },
      '@/lib/api/learning': {
        uploadImage: async (id, file) => {
          uploaded.push({ id, file });
          server.images.push(photo(`photo-${uploaded.length}`));
          server.revision++;
          if (uploadFailure) throw uploadFailure;
        },
        uploadDocument: async () => {
          server.documents = [{ id: 'pdf', state: 'processing', pages: [], errorCode: null }];
          server.revision++;
        },
        deleteDocument: async () => {
          server.documents = [];
          server.images = server.images.filter((image) => !image.sourceDocumentId);
          server.revision++;
        },
        deleteImage: async (_id, imageId) => {
          server.images = server.images.filter((image) => image.id !== imageId);
          server.revision++;
        },
      },
    },
    { crypto: { randomUUID: () => `key-${++counter}` } },
  );
  const store = load('@/stores/school-store').useSchoolStore;
  store.getState().setSession(identity);
  store.getState().setAssignment({ ...assignment(), submission: initial });
  const useSchoolSubmission = load('@/hooks/use-school-submission').useSchoolSubmission;
  return {
    render: () => hooks.render(() => useSchoolSubmission(store.getState().assignment)),
    store: store.getState,
    created,
    uploaded,
    fixtures,
    cancelled,
    failCancel: (cause) => {
      cancelFailure = cause;
    },
    finalized,
    refreshes: () => refreshes,
    failCreate: (cause) => {
      createFailure = cause;
    },
    failUpload: (cause) => {
      uploadFailure = cause;
    },
    failFinalize: (cause) => {
      finalizeFailure = cause;
    },
    apiError: load('@/lib/api/client').ApiError,
    server: () => server,
  };
}

test('school upload creates one idempotent draft and finalizes current revision once', async () => {
  const flow = uploadFlow();
  await flow.render().upload([{ name: 'photo.jpg', type: 'image/jpeg', size: 10 }]);
  assert.equal(flow.created.length, 1);
  assert.equal(flow.uploaded.length, 1);
  assert.equal(flow.store().assignment.submission.revision, 2);
  await flow.render().send();
  assert.deepEqual(flow.finalized, [{ id: 'submission', revision: 2 }]);
  assert.equal(flow.store().assignment.submission.status, 'queued');
});

test('draft creation retains idempotency key after lost response', async () => {
  const flow = uploadFlow();
  const file = { name: 'photo.jpg', type: 'image/jpeg', size: 10 };
  flow.failCreate(new TypeError('network'));
  await flow.render().upload([file]);
  flow.failCreate(null);
  await flow.render().retryUpload();
  assert.equal(flow.created.length, 2);
  assert.equal(flow.created[0].key, flow.created[1].key);
  assert.equal(flow.uploaded.length, 1);
});

test('unknown upload outcome refreshes uploaded pages and never silently reuploads a file', async () => {
  const flow = uploadFlow();
  flow.failUpload(new TypeError('network'));
  await flow.render().upload([{ name: 'photo.jpg', type: 'image/jpeg', size: 10 }]);
  assert.equal(flow.store().assignment.submission.images.length, 1);
  assert.equal(flow.render().pendingFiles.length, 0);
  await flow.render().retryUpload();
  assert.equal(flow.uploaded.length, 1);
});

test('an unreadable upload response recovers the accepted file without duplicating it', async () => {
  const flow = uploadFlow();
  flow.failUpload(new SyntaxError('Unexpected end of JSON input'));
  await flow.render().upload([{ name: 'photo.jpg', type: 'image/jpeg', size: 10 }]);
  assert.equal(flow.store().assignment.submission.images.length, 1);
  assert.equal(flow.render().pendingFiles.length, 0);
  await flow.render().retryUpload();
  assert.equal(flow.uploaded.length, 1);
});

test('PDF processing survives fresh hook and blocks finalize until deletion or ready', async () => {
  const flow = uploadFlow();
  await flow.render().upload([{ name: 'solution.pdf', type: 'application/pdf', size: 10 }]);
  assert.equal(flow.store().assignment.submission.documents[0].state, 'processing');
  await flow.render().send();
  assert.equal(flow.finalized.length, 0);
  await flow.render().removeDocument('pdf');
  assert.equal(flow.store().assignment.submission.documents.length, 0);
});

test('revision conflict reloads server state without a second finalize', async () => {
  const flow = uploadFlow(submission({ images: [photo()] }));
  flow.failFinalize(new flow.apiError(409, 'conflict', 'revision_conflict'));
  await flow.render().send();
  assert.equal(flow.finalized.length, 1);
  assert.equal(flow.store().assignment.submission.status, 'draft');
  assert.ok(flow.store().error);
});

test('a confirmed pre-dispatch refusal retains its explanation without recovery or automatic retry', async () => {
  const { SCHOOL_COPY } = moduleLoader()('@/config/school');
  const flow = uploadFlow(submission({ images: [photo()] }));
  flow.failFinalize(new flow.apiError(503, SCHOOL_COPY.checkingUnavailable, 'grading_unavailable'));
  await flow.render().send();
  assert.equal(flow.store().error, SCHOOL_COPY.checkingUnavailable);
  assert.equal(flow.store().assignment.submission.status, 'draft');
  assert.equal(flow.finalized.length, 1);
  assert.equal(flow.refreshes(), 0);
});

test('network, unreadable responses and unknown server refusals remain ambiguous after finalize', async () => {
  const { SCHOOL_COPY } = moduleLoader()('@/config/school');
  for (const error of [
    () => new TypeError('network'),
    () => new SyntaxError('Invalid response'),
    (ApiError) => new ApiError(502, 'Gateway error', 'grading_unavailable'),
    (ApiError) => new ApiError(503, 'Unavailable', 'unexpected_error'),
    (ApiError) => new ApiError(503, 'Unavailable'),
  ]) {
    const flow = uploadFlow(submission({ images: [photo()] }));
    flow.failFinalize(error(flow.apiError));
    await flow.render().send();
    assert.equal(flow.store().error, SCHOOL_COPY.sendUncertain);
    assert.equal(flow.finalized.length, 1);
    assert.equal(flow.refreshes(), 1);
  }
});

test('storage failures during file upload remain ambiguous and cannot silently duplicate files', async () => {
  const flow = uploadFlow();
  flow.failUpload(new flow.apiError(503, 'Unavailable', 'storage_unavailable'));
  await flow.render().upload([{ name: 'photo.jpg', type: 'image/jpeg', size: 10 }]);
  assert.equal(flow.store().assignment.submission.images.length, 1);
  assert.equal(flow.render().pendingFiles.length, 0);
  await flow.render().retryUpload();
  assert.equal(flow.uploaded.length, 1);
});

test('pending files show calm progress during upload and recovery only after it finishes', () => {
  const load = moduleLoader();
  const { SchoolPendingFiles } = load('@/components/school/SchoolPendingFiles');
  const { SCHOOL_COPY } = load('@/config/school');
  const actions = {
    busy: true,
    pendingFiles: [{ name: 'solution.pdf' }],
    retryUpload() {},
    clearPendingFiles() {},
  };
  const render = (next) =>
    renderToStaticMarkup(createElement(SchoolPendingFiles, { actions: next }));
  const uploading = render(actions);
  assert.match(uploading, /role="status"/);
  assert.ok(uploading.includes(SCHOOL_COPY.uploadingFiles));
  assert.doesNotMatch(uploading, /<button/);
  assert.equal(uploading.includes(SCHOOL_COPY.pendingFiles(1)), false);
  const failed = render({ ...actions, busy: false });
  assert.ok(failed.includes(SCHOOL_COPY.retryUpload));
  assert.ok(failed.includes(SCHOOL_COPY.clearPendingFiles));
  assert.ok(failed.includes(SCHOOL_COPY.pendingFiles(1)));
  assert.equal(render({ ...actions, pendingFiles: [] }), '');
});

test('revoked access clears all private school data on mutation failure', async () => {
  const flow = uploadFlow(submission({ images: [photo()] }));
  flow.failFinalize(new flow.apiError(403, 'forbidden'));
  await flow.render().send();
  assert.equal(flow.store().session, null);
  assert.equal(flow.store().assignment, null);
  assert.deepEqual(flow.store().assignments, []);
});

function pollingFlow() {
  const hooks = hookHarness();
  const timers = new Map(),
    docEvents = new Map(),
    winEvents = new Map();
  let counter = 0,
    calls = 0;
  let response = async () => submission({ status: 'running' });
  const document = {
    visibilityState: 'visible',
    addEventListener: (key, fn) => docEvents.set(key, fn),
    removeEventListener: (key) => docEvents.delete(key),
  };
  const load = moduleLoader(
    {
      react: hooks.react,
      zustand: { create: memoryStore() },
      '@/lib/api/school': {
        fetchSchoolSubmission: async () => {
          calls++;
          return response();
        },
        fetchSchoolAssignment: async () => ({
          ...assignment(),
          canResubmit: true,
          submission: await response(),
        }),
        schoolErrorMessage: (cause) => cause.message,
      },
    },
    {
      document,
      window: {
        addEventListener: (key, fn) => winEvents.set(key, fn),
        removeEventListener: (key) => winEvents.delete(key),
      },
      setTimeout: (fn, delay) => {
        const id = ++counter;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const store = load('@/stores/school-store').useSchoolStore;
  store.getState().setSession(identity);
  store
    .getState()
    .setAssignment({ ...assignment(), submission: submission({ status: 'running' }) });
  const useSchoolPoll = load('@/hooks/use-school-poll').useSchoolPoll;
  return {
    render: (delay = 2000) =>
      hooks.render(() => useSchoolPoll(store.getState().session?.id ?? null, 'submission', delay)),
    store: store.getState,
    timers,
    calls: () => calls,
    respond: (fn) => {
      response = fn;
    },
    focus: () => winEvents.get('focus')?.(),
    visibility: (state) => {
      document.visibilityState = state;
      docEvents.get('visibilitychange')?.();
    },
    tick: async () => {
      const [id, { fn }] = timers.entries().next().value;
      timers.delete(id);
      fn();
      await settle();
    },
    unmount: () => hooks.unmount(),
    apiError: load('@/lib/api/client').ApiError,
  };
}

test('polls pause while hidden and focus requests are serialized', async () => {
  const flow = pollingFlow();
  flow.render();
  assert.equal(flow.timers.size, 1);
  flow.visibility('hidden');
  assert.equal(flow.timers.size, 0);
  flow.focus();
  assert.equal(flow.calls(), 0);
  const waiting = deferred();
  flow.respond(() => waiting.promise);
  flow.visibility('visible');
  flow.focus();
  assert.equal(flow.calls(), 1);
  waiting.resolve(submission({ status: 'running', revision: 2 }));
  await settle();
  assert.equal(flow.store().assignment.submission.revision, 2);
  flow.render(null);
  assert.equal(flow.timers.size, 0);
  flow.unmount();
});

test('polling403 revokes cached media and stops immediately', async () => {
  const flow = pollingFlow();
  flow.respond(async () => {
    throw new flow.apiError(403, 'forbidden');
  });
  flow.render();
  await flow.tick();
  assert.equal(flow.store().assignment, null);
  assert.equal(flow.store().session, null);
  assert.equal(flow.timers.size, 0);
  flow.focus();
  assert.equal(flow.calls(), 1);
  flow.unmount();
});

function workspaceFlow() {
  const hooks = hookHarness();
  let getSession = async () => {
    throw new TypeError('network');
  };
  const create = (initializer) => {
    const memory = memoryStore()(initializer);
    const store = (selector = (state) => state) => selector(memory.getState());
    store.getState = memory.getState;
    return store;
  };
  const load = moduleLoader({
    react: hooks.react,
    zustand: { create },
    '@/hooks/use-school-poll': { useSchoolPoll() {} },
    '@/lib/api/school': {
      fetchSchoolSession: () => getSession(),
      fetchSchoolAssignments: async () => [assignment()],
      schoolErrorMessage: (cause) => cause.message,
    },
  });
  const store = load('@/stores/school-store').useSchoolStore;
  const useSchoolWorkspace = load('@/hooks/use-school-workspace').useSchoolWorkspace;
  return {
    render: () => hooks.render(useSchoolWorkspace),
    store: store.getState,
    sessionResponse: (get) => {
      getSession = get;
    },
    apiError: load('@/lib/api/client').ApiError,
    unmount: hooks.unmount,
  };
}

test('bootstrap outage remains unresolved and refresh restores session without password entry', async () => {
  const flow = workspaceFlow();
  flow.render();
  await settle();
  assert.equal(flow.store().sessionResolved, false);
  assert.equal(flow.store().loading, false);
  assert.equal(flow.store().error, 'network');
  flow.sessionResponse(async () => identity);
  await flow.render().refresh();
  assert.equal(flow.store().sessionResolved, true);
  assert.equal(flow.store().session.id, identity.id);
  assert.equal(flow.store().assignments.length, 1);
  flow.unmount();
});

test('bootstrap403 removes previously cached assignment and media', async () => {
  const flow = workspaceFlow();
  flow.store().setSession(identity);
  flow.store().setAssignment({ ...assignment(), submission: submission({ images: [photo()] }) });
  flow.sessionResponse(async () => {
    throw new flow.apiError(403, 'forbidden');
  });
  flow.render();
  await settle();
  assert.equal(flow.store().session, null);
  assert.equal(flow.store().assignment, null);
  assert.equal(flow.store().sessionResolved, true);
  flow.unmount();
});

test('all seven task numbers share the configured allowlist', () => {
  const { B2B_TASK_NUMBERS } = moduleLoader()('@/config/b2b');
  assert.deepEqual(Array.from(B2B_TASK_NUMBERS), [14, 15, 16, 17, 18, 19, 20]);
});

test('assignment pagination makes every annotated work accessible', async () => {
  const cursors = [];
  const load = moduleLoader({
    '@/lib/api/client': {
      apiFetch: async (url) => {
        const cursor = new URL(url, 'http://local.test').searchParams.get('cursor');
        cursors.push(cursor);
        const offset = cursor ? Number(cursor) : 0;
        return {
          items: Array.from({ length: 50 }, (_, index) => ({ id: String(offset + index) })),
          nextCursor: offset < 200 ? String(offset + 50) : null,
        };
      },
    },
  });
  const all = await load('@/lib/api/school').fetchSchoolAssignments();
  assert.equal(all.length, 250);
  assert.equal(new Set(all.map((item) => item.id)).size, 250);
  assert.deepEqual(cursors, [null, '50', '100', '150', '200']);
});

test('new draft preserves earlier final result and history updates do not duplicate attempts', () => {
  const load = moduleLoader({ zustand: { create: memoryStore() } });
  const store = load('@/stores/school-store').useSchoolStore;
  const old = submission({
    status: 'returned',
    expertReview: { status: 'sent' },
    result: canonical,
  });
  store.getState().setAssignment({ ...assignment(), submission: old, history: [old] });
  const next = submission({ id: 'new', createdAt: '2026-10-22T10:00:00Z' });
  store.getState().acceptSubmission(next);
  store.getState().acceptSubmission({ ...next, revision: 2 });
  const current = store.getState().assignment;
  assert.equal(current.submission.id, 'new');
  assert.equal(current.history.length, 2);
  assert.equal(current.history[1].result.grading.score, 1);
  assert.equal(current.history[0].revision, 2);
});

test('fixture button attaches assigned server files to a draft without grading', async () => {
  const h = uploadFlow();
  h.store().setAssignment({ ...assignment(), fixtureAvailable: true });
  await h.render().attachFixture();
  assert.equal(h.created.length, 1);
  assert.deepEqual(h.fixtures, [{ assignmentId: 'assignment', submissionId: 'submission' }]);
  assert.equal(h.finalized.length, 0);
  assert.equal(h.store().assignment.submission.images[0].id, 'fixture');
});

test('successful new solution uses fresh idempotency key and no failure retry reference', async () => {
  const h = uploadFlow();
  await h.render().upload([new File(['x'], 'first.jpg', { type: 'image/jpeg' })]);
  const previous = { ...h.store().assignment.submission, status: 'returned', retryable: false };
  h.store().setAssignment({ ...assignment(), canResubmit: true, submission: previous });
  await h.render().retry();
  assert.equal(h.created.length, 2);
  assert.notEqual(h.created[0].key, h.created[1].key);
  assert.equal(h.created[1].retryOfId, undefined);
});

test('polling a completed attempt refreshes server permission for a new solution', async () => {
  const flow = pollingFlow();
  flow.render();
  flow.respond(async () => submission({ status: 'awaiting_expert', revision: 2 }));
  await flow.tick();
  assert.equal(flow.store().assignment.canResubmit, true);
  assert.equal(flow.store().assignment.submission.status, 'awaiting_expert');
  flow.unmount();
});

test('incomplete fixture blocks normal mutation and needs explicit cancel before replacement', async () => {
  const h = uploadFlow(submission({ images: [photo()] }));
  h.store().setAssignment({ ...h.store().assignment, fixtureAttachmentIncomplete: true });
  assert.ok(h.render().sendDisabled);
  await h.render().send();
  await h.render().upload([{ name: 'more.jpg', type: 'image/jpeg', size: 10 }]);
  assert.equal(h.uploaded.length, 0);
  assert.equal(h.finalized.length, 0);
  assert.equal(h.cancelled.length, 0);
  await h.render().restartFixture();
  assert.deepEqual(h.cancelled, ['submission']);
  assert.equal(h.created[0].retryOfId, 'submission');
  assert.equal(h.store().assignment.submission.id, 'replacement');
  assert.equal(h.store().assignment.fixtureAttachmentIncomplete, false);
  assert.equal(h.store().assignment.history[1].status, 'cancelled');
});

test('uncertain cancellation does not create a replacement or repeat cancellation automatically', async () => {
  const h = uploadFlow(submission());
  h.store().setAssignment({ ...h.store().assignment, fixtureAttachmentIncomplete: true });
  h.failCancel(new TypeError('network'));
  await h.render().restartFixture();
  assert.equal(h.cancelled.length, 1);
  assert.equal(h.created.length, 0);
  assert.equal(h.store().assignment.submission.status, 'draft');
});
