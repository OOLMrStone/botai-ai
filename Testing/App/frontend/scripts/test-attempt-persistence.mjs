import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  moduleLoader,
  hookHarness,
  memoryStore,
  settle,
  deferred,
} from './helpers/hook-harness.mjs';

function setup(items, canReviewPhoto = true, withShell = false) {
  const harness = hookHarness();
  const timers = new Map();
  let sequence = 0;
  const stroke = (id) => [{ id, coordinateSpace: 'width', points: [{ x: 0.1, y: 0.1 }] }];
  let server = {
    id: 'attempt',
    revision: 1,
    currentIndex: 0,
    status: 'in_progress',
    summary: { graded: 0 },
    items: items ?? [
      { id: 'item', answer: '', drawing: [], task: {}, submission: { status: 'queued' } },
    ],
  };
  const checks = [];
  const finalized = [];
  const created = [];
  const uploaded = [];
  const documentsUploaded = [];
  const documentsDeleted = [];
  let get = async () => structuredClone(server);
  let patch = async (_id, body) => {
    if (body.revision !== server.revision)
      throw new (load('@/lib/api/client').ApiError)(409, 'conflict');
    server = {
      ...server,
      revision: server.revision + 1,
      currentIndex: body.currentIndex ?? server.currentIndex,
      items: server.items.map((item) => ({
        ...item,
        ...body.items.find((edit) => edit.id === item.id),
      })),
    };
    return structuredClone(server);
  };
  const load = moduleLoader(
    {
      react: harness.react,
      zustand: { create: () => memoryStore() },
      'next/navigation': { useRouter: () => ({ push() {} }) },
      '@/hooks/use-plan': { useHasFeature: (feature) => feature === 'aiReview' && canReviewPhoto },
      '@/hooks/use-paywall': { usePaywall: () => ({ visible: false, open() {} }) },
      '@/hooks/use-attempt-activity': {
        useAttemptActivity() {
          return { pause: async () => {} };
        },
      },
      '@/hooks/use-keyboard-viewport': { useKeyboardViewport() {} },
      '@/hooks/use-task-keyboard-navigation': { useTaskKeyboardNavigation() {} },
      '@/lib/api/learning': {
        fetchAttempt: (...args) => get(...args),
        patchAttempt: (...args) => patch(...args),
        fetchSubmission: async (id) =>
          server.items.find((item) => item.submission?.id === id).submission,
        finalizeSubmission: async (id) => {
          finalized.push(id);
        },
        checkAttempt: async (...args) => {
          checks.push(args);
          return structuredClone(server);
        },
        createSubmission: async (...args) => {
          created.push(args);
          const submission = {
            id: `retry-${created.length}`,
            status: 'draft',
            images: [],
            revision: 0,
            attemptItemId: args[1],
          };
          server.items = server.items.map((item) =>
            item.id === args[1] ? { ...item, submission } : item,
          );
          return structuredClone(submission);
        },
        uploadDocument: async (id, file) => {
          documentsUploaded.push([id, file]);
          const item = server.items.find((item) => item.submission?.id === id);
          item.submission.attemptItemId = item.id;
          item.submission.documents = [
            { id: 'document', state: 'processing', pages: [], errorCode: null },
          ];
          item.submission.revision++;
          return item.submission.documents[0];
        },
        deleteDocument: async (id, documentId) => {
          documentsDeleted.push([id, documentId]);
          const item = server.items.find((item) => item.submission?.id === id);
          item.submission.documents = [];
          item.submission.images = item.submission.images.filter(
            (image) => image.sourceDocumentId !== documentId,
          );
          item.submission.revision++;
        },
        uploadImage: async (id, file) => {
          uploaded.push([id, file]);
          const submission = server.items.find((item) => item.submission?.id === id).submission;
          submission.images.push({ id: `photo-${uploaded.length}`, status: 'ready' });
          submission.revision++;
        },
      },
      '@/lib/image-validation': { imageRejection: async () => null },
      '@/lib/learning-resources': { invalidateAttempts() {} },
      '@/lib/attempt': { ...moduleLoader()('@/lib/attempt'), itemLocked: () => false },
    },
    {
      window: { addEventListener() {}, removeEventListener() {} },
      setTimeout: (fn) => {
        timers.set(++sequence, fn);
        return sequence;
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn) => {
        timers.set(++sequence, fn);
        return sequence;
      },
      clearInterval: (id) => timers.delete(id),
    },
  );
  const store = load('@/stores/tasks-store').useTasksStore;
  const render = () =>
    harness.render(() =>
      withShell
        ? load('@/hooks/use-training-shell').useTrainingShell('attempt')
        : load('@/hooks/use-attempt').useAttempt('attempt'),
    );
  const init = async () => {
    render();
    await settle();
    return render();
  };
  return {
    harness,
    load,
    store,
    render,
    init,
    stroke,
    timers,
    checks,
    finalized,
    created,
    uploaded,
    documentsUploaded,
    documentsDeleted,
    server: () => server,
    setGet(fn) {
      get = fn;
    },
    setPatch(fn) {
      patch = fn;
    },
    remote(next) {
      server = { ...server, ...next };
    },
  };
}

test('transport retry preserves answer and drawing, including failed discard GET', async () => {
  const s = setup();
  let api = await s.init();
  api.setAnswer('item', '123');
  s.store.getState().setDrawing('item', s.stroke('local'));
  s.store.getState().commitDrawing('item');
  s.setPatch(async () => {
    throw new Error('offline');
  });
  await s.render().save();
  s.setGet(async () => {
    throw new Error('offline');
  });
  await s.render().reload();
  assert.equal(s.render().answers.item, '123');
  assert.equal(s.store.getState().savedDrawings.item[0].id, 'local');
  let sent;
  s.setPatch(async (_id, body) => {
    sent = body;
    return { ...s.server(), revision: 2, items: [{ ...s.server().items[0], ...body.items[0] }] };
  });
  await s.render().retry();
  assert.equal(sent.items[0].answer, '123');
  assert.equal(sent.items[0].drawing[0].id, 'local');
  assert.equal(s.render().unsaved, false);
});

const short = (id, answer) => ({ id, answer, drawing: [], task: { responseType: 'short' } });
const photo = (id, status, gradingCapability = 'available') => ({
  id,
  answer: '',
  drawing: [],
  task: { responseType: 'photo', gradingCapability },
  submission: {
    id: `submission-${id}`,
    status,
    images: [{ id: 'image', status: 'ready' }],
    revision: 1,
  },
});

test('batch check includes only valid answers and ready photos, preserving incomplete input', async () => {
  const s = setup([
    short('valid', '0'),
    short('incomplete', '2,'),
    short('sign', '-'),
    short('empty', ''),
    photo('photo', 'draft'),
    photo('failed', 'failed'),
    photo('queued', 'queued'),
    photo('unsupported', 'draft', 'unsupported'),
    photo('unavailable', 'draft', 'unavailable'),
  ]);
  await s.init();
  await s.render().check();
  assert.deepEqual(s.finalized, ['submission-photo']);
  assert.equal(s.checks.length, 1);
  assert.deepEqual(s.checks[0][3], ['valid', 'photo']);
  assert.equal(s.server().items.find((item) => item.id === 'incomplete').answer, '2,');
});

for (const canReviewPhoto of [false, true]) {
  test(`mixed review and batch share photo feature eligibility: ${canReviewPhoto}`, async () => {
    const s = setup([short('valid', '0'), photo('photo', 'draft')], canReviewPhoto, true);
    await s.init();
    const view = s.render();
    assert.equal(view.canReviewPhoto, canReviewPhoto);
    assert.equal(view.readyCount, canReviewPhoto ? 2 : 1);
    assert.equal(view.needsPro, !canReviewPhoto);
    assert.deepEqual(
      view.reviewItems.map((item) => item.state),
      ['ready', canReviewPhoto ? 'ready' : 'pro'],
    );
    const copy = s.load('@/config/training-review').TRAINING_REVIEW_COPY;
    assert.equal(view.reviewDescription, canReviewPhoto ? copy.ready : copy.readyWithProPhotos);
    await view.check();
    assert.deepEqual(s.finalized, canReviewPhoto ? ['submission-photo'] : []);
    assert.deepEqual(s.checks[0][3], canReviewPhoto ? ['valid', 'photo'] : ['valid']);
    assert.equal(s.server().items[1].submission.images.length, 1);
    assert.equal(s.render().error, null);
  });
}

test('free photo flow announces Pro in advance, permits storage and never dispatches a check', async () => {
  const item = photo('photo', 'draft');
  item.submission.images = [];
  const s = setup([item], false, true);
  await s.init();
  const copy = s.load('@/config/training-review').TRAINING_REVIEW_COPY;
  assert.equal(s.render().photoNotice, copy.photoProNotice);
  assert.equal(s.render().readyCount, 0);
  const file = { name: 'solution.png', type: 'image/png' };
  await s.render().upload('photo', [file]);
  assert.deepEqual(s.uploaded, [['submission-photo', file]]);
  assert.equal(s.render().attempt.items[0].submission.images.length, 1);
  assert.equal(s.render().readyCount, 0);
  assert.equal(s.render().reviewItems[0].state, 'pro');
  assert.equal(s.render().reviewDescription, copy.photoSavedPro);
  const { attemptFeedback } = s.load('@/lib/attempt-feedback');
  assert.equal(attemptFeedback(s.render().attempt.items[0], false).label, copy.photoSavedPro);
  await s.render().check();
  assert.deepEqual(s.finalized, []);
  assert.deepEqual(s.checks, []);
  assert.equal(s.render().error, null);
  assert.equal(s.render().attempt.items[0].submission.images.length, 1);
});

test('photo feature gate preserves pending checks, existing grades and upload recovery', () => {
  const load = moduleLoader();
  const { itemReadyToCheck, itemReviewState } = load('@/lib/attempt');
  const { attemptFeedback } = load('@/lib/attempt-feedback');
  const queued = photo('queued', 'queued');
  assert.equal(itemReviewState(queued, false), 'pending');
  assert.equal(itemReadyToCheck(queued, false), false);
  assert.equal(attemptFeedback(queued, false).canCancel, true);
  const graded = {
    ...photo('graded', 'graded'),
    result: { isGraded: true, score: 2, maxScore: 2 },
  };
  assert.equal(itemReviewState(graded, false), 'correct');
  assert.equal(attemptFeedback(graded, false).label, '2 из 2 баллов');
  const expired = photo('expired', 'expired');
  expired.submission.retryable = true;
  assert.equal(itemReviewState(expired, false), 'expired');
  assert.equal(attemptFeedback(expired, false).canRetry, true);
  assert.equal(
    attemptFeedback(expired, false).retryLabel,
    load('@/config/attempt-feedback').ATTEMPT_FEEDBACK_COPY.retryPhoto,
  );
});

test('checking a draft without ready answers does not submit an empty check', async () => {
  const s = setup([{ id: 'item', answer: '-', drawing: [], task: { responseType: 'short' } }]);
  await s.init();
  await s.render().check();
  assert.equal(s.checks.length, 0);
  assert.equal(s.server().items[0].answer, '-');
});

test('review distinguishes recoverable photo failures and unsupported tasks from ready answers', () => {
  const { itemReadyToCheck, itemReviewState } = moduleLoader()('@/lib/attempt');
  const photo = {
    answer: '',
    task: { responseType: 'photo', gradingCapability: 'available' },
    submission: { status: 'draft', images: [{ id: 'image', status: 'ready' }] },
  };
  assert.equal(itemReadyToCheck(photo, true), true);
  for (const status of [
    'failed',
    'rejected',
    'cancelled',
    'expired',
    'unsupported',
    'queued',
    'running',
  ]) {
    const item = { ...photo, submission: { ...photo.submission, status } };
    assert.equal(itemReadyToCheck(item, true), false);
    assert.equal(
      itemReviewState(item, true),
      ['queued', 'running'].includes(status) ? 'pending' : status,
    );
  }
  for (const gradingCapability of ['unsupported', 'unavailable']) {
    const item = { ...photo, task: { ...photo.task, gradingCapability } };
    assert.equal(itemReadyToCheck(item, true), false);
    assert.equal(itemReviewState(item, true), gradingCapability);
  }
  const graded = { ...photo, result: { isGraded: true, score: 0, maxScore: 3 } };
  assert.equal(itemReadyToCheck(graded, true), false);
  assert.equal(itemReviewState(graded, true), 'incorrect');
});

test('zero is checkable while unfinished signs and decimals remain editable drafts', () => {
  const { itemReadyToCheck, itemReviewState } = moduleLoader()('@/lib/attempt');
  const item = { answer: '0', task: { responseType: 'short' } };
  assert.equal(itemReadyToCheck(item, false), true);
  for (const answer of ['-', '2,', '2.']) {
    assert.equal(itemReadyToCheck({ ...item, answer }, false), false);
    assert.equal(itemReviewState({ ...item, answer }, false), 'invalid');
  }
});

test('expired photo recovery creates a fresh draft before accepting another upload', async () => {
  const expired = {
    id: 'expired',
    status: 'expired',
    revision: 3,
    retryable: true,
    images: [{ id: 'old-photo' }],
  };
  const s = setup([
    {
      id: 'item',
      answer: '',
      drawing: [],
      answerRevision: 4,
      task: { responseType: 'photo', gradingCapability: 'available' },
      submission: expired,
    },
  ]);
  await s.init();
  await s.render().retrySubmission('item');
  assert.equal(s.created.length, 1);
  assert.deepEqual(s.created[0].slice(0, 3), ['attempt', 'item', 4]);
  assert.equal(typeof s.created[0][3], 'string');
  assert.equal(s.created[0][4], 'expired');
  assert.equal(s.render().attempt.items[0].submission.status, 'draft');
  await s.render().retrySubmission('item');
  assert.equal(s.created.length, 1);
  const file = { name: 'replacement.png', type: 'image/png' };
  await s.render().upload('item', [file]);
  assert.deepEqual(s.uploaded, [['retry-1', file]]);
  assert.equal(s.render().attempt.items[0].submission.images.length, 1);
  assert.equal(s.render().attempt.items[0].submission.revision, 1);
  assert.deepEqual(expired.images, [{ id: 'old-photo' }]);
});

test('SPA Back/remount keeps attempt draft; owner reset removes it and ignores late ACK', async () => {
  const s = setup();
  const api = await s.init();
  api.setAnswer('item', '123');
  s.harness.unmount();
  await s.init();
  assert.equal(s.render().answers.item, '123');
  const write = deferred();
  s.setPatch(() => write.promise);
  const saving = s.render().save();
  s.load('@/lib/attempt-drafts').clearAttemptDrafts();
  s.store.getState().reset();
  s.harness.unmount();
  write.resolve({ ...s.server(), revision: 2, items: [{ ...s.server().items[0], answer: '123' }] });
  await saving;
  await s.init();
  assert.deepEqual(s.render().answers, {});
  assert.equal(s.render().attempt.revision, 1);
});

test('late polling GET cannot roll back accepted PATCH', async () => {
  const s = setup();
  await s.init();
  const poll = deferred();
  s.setGet(() => poll.promise);
  [...s.timers.values()].forEach((fn) => fn());
  await settle();
  await s.render().select(1);
  assert.equal(s.render().attempt.currentIndex, 1);
  poll.resolve({ ...s.server(), revision: 1, currentIndex: 0 });
  await settle();
  assert.equal(s.render().attempt.revision, 2);
  assert.equal(s.render().attempt.currentIndex, 1);
});

test('ACK removes only captured answer/drawing, preserving edits made during save', async () => {
  const s = setup();
  let api = await s.init();
  const first = s.stroke('A');
  api.setAnswer('item', 'A');
  s.store.getState().setDrawing('item', first);
  s.store.getState().commitDrawing('item');
  const write = deferred();
  s.setPatch(() => write.promise);
  const saving = s.render().save();
  s.render().setAnswer('item', 'AB');
  const second = s.stroke('AB');
  s.store.getState().setDrawing('item', second);
  s.store.getState().commitDrawing('item');
  write.resolve({
    ...s.server(),
    revision: 2,
    items: [{ ...s.server().items[0], answer: 'A', drawing: first }],
  });
  await saving;
  assert.equal(s.render().answers.item, 'AB');
  assert.strictEqual(s.store.getState().savedDrawings.item, second);
});

test('fresh server drawings hydrate only clean items; remote revision cannot rebase dirty draft', async () => {
  const s = setup();
  await s.init();
  const state = s.store.getState();
  state.hydrate([{ id: 'item', drawing: s.stroke('remote') }]);
  assert.equal(s.store.getState().drawings.item[0].id, 'remote');
  state.setDrawing('item', s.stroke('gesture'));
  state.hydrate([{ id: 'item', drawing: s.stroke('remote2') }]);
  assert.equal(s.store.getState().drawings.item[0].id, 'gesture');
  state.commitDrawing('item');
  state.hydrate([{ id: 'item', drawing: s.stroke('remote2') }]);
  assert.equal(s.store.getState().drawings.item[0].id, 'gesture');
  s.render().setAnswer('item', '123');
  s.remote({ revision: 2 });
  s.harness.unmount();
  await s.init();
  assert.equal(s.render().conflict, true);
  assert.equal(s.render().attempt.revision, 1);
  assert.equal(s.render().answers.item, '123');
  await s.render().reload();
  assert.equal(s.render().attempt.revision, 2);
  assert.deepEqual(s.render().answers, {});
  assert.deepEqual(s.store.getState().drawings.item, []);
});

test('same-revision stale poll cannot undo accepted submission changes', async () => {
  const s = setup();
  await s.init();
  const poll = deferred();
  s.setGet(() => poll.promise);
  [...s.timers.values()].forEach((fn) => fn());
  await settle();
  const ready = {
    ...s.server(),
    items: [{ ...s.server().items[0], submission: { status: 'graded' } }],
  };
  s.setPatch(async () => ready);
  await s.render().select(1);
  poll.resolve(s.server());
  await settle();
  assert.equal(s.render().attempt.items[0].submission.status, 'graded');
});

test('remote revision while dirty blocks PATCH until explicit successful discard', async () => {
  const s = setup();
  await s.init();
  s.render().setAnswer('item', '123');
  s.remote({ revision: 2 });
  s.harness.unmount();
  await s.init();
  let patches = 0;
  s.setPatch(async () => {
    patches++;
    return s.server();
  });
  await s.render().save();
  assert.equal(patches, 0);
  assert.equal(s.render().answers.item, '123');
});

test('discard scopes answers/drawings/gesture flags to one attempt', async () => {
  const s = setup();
  await s.init();
  const other = s.load('@/lib/attempt-drafts').attemptDraft('other');
  other.setAnswer('other-item', '456');
  s.store.getState().setDrawing('other-item', s.stroke('other'));
  s.store.getState().commitDrawing('other-item');
  s.store.getState().setDrawing('item', s.stroke('local'));
  s.render().setAnswer('item', '123');
  await s.render().reload();
  assert.equal(other.answers['other-item'], '456');
  assert.equal(s.store.getState().savedDrawings['other-item'][0].id, 'other');
  assert.equal(s.store.getState().editingDrawings.item, undefined);
  assert.deepEqual(s.store.getState().drawings.item, []);
});

test('PDF upload stays processing across reload, polls durable pages and blocks finalize until ready', async () => {
  const item = photo('pdf', 'draft');
  item.submission.attemptItemId = item.id;
  item.submission.images = [];
  const s = setup([item]);
  await s.init();
  const file = { name: 'solution.pdf', type: 'application/pdf', size: 1024 };
  await s.render().upload(item.id, [file]);
  assert.deepEqual(s.documentsUploaded, [[item.submission.id, file]]);
  assert.deepEqual(s.uploaded, []);
  assert.equal(s.render().attempt.items[0].submission.documents[0].state, 'processing');
  await s.render().check();
  assert.deepEqual(s.finalized, []);
  assert.equal(
    s.load('@/lib/attempt').itemReviewState(s.server().items[0], true),
    'document_processing',
  );

  // Новая сессия читает серверный processing, а не локальный флаг upload.
  const reloaded = setup(structuredClone(s.server().items));
  await reloaded.init();
  assert.equal(reloaded.render().attempt.items[0].submission.documents[0].state, 'processing');
  const submission = reloaded.server().items[0].submission;
  submission.documents[0].state = 'ready';
  submission.images = [
    { id: 'page-1', status: 'ready', sourceDocumentId: 'document', pageNumber: 1 },
  ];
  submission.revision++;
  for (const timer of [...reloaded.timers.values()]) await timer();
  await settle();
  assert.equal(reloaded.render().attempt.items[0].submission.documents[0].state, 'ready');
  await reloaded.render().check();
  assert.deepEqual(reloaded.finalized, [submission.id]);
  await reloaded.render().removeDocument(submission.id, 'document');
  assert.deepEqual(reloaded.documentsDeleted, [[submission.id, 'document']]);
  assert.deepEqual(reloaded.render().attempt.items[0].submission.images, []);
});

test('solution validation accepts bounded PDF without decoding it as an image', async () => {
  const { solutionFileRejection, submissionPagesReady, solutionDocumentError } = moduleLoader()(
    '@/lib/solution-validation',
  );
  const { INTEGRATION, LEARNING_COPY } = moduleLoader()('@/config/integration');
  assert.equal(
    await solutionFileRejection({ type: 'application/pdf', size: INTEGRATION.maxImageBytes }),
    null,
  );
  assert.equal(
    await solutionFileRejection({ type: 'application/pdf', size: INTEGRATION.maxImageBytes + 1 }),
    LEARNING_COPY.solutionFileSize,
  );
  assert.equal(
    await solutionFileRejection({ type: 'text/plain', size: 100 }),
    LEARNING_COPY.solutionFileType,
  );
  assert.equal(submissionPagesReady({ images: [{ status: 'staged' }] }), false);
  assert.equal(
    submissionPagesReady({ images: [{ status: 'ready' }], documents: [{ state: 'processing' }] }),
    false,
  );
  assert.equal(
    submissionPagesReady({ images: [{ status: 'ready' }], documents: [{ state: 'failed' }] }),
    false,
  );
  assert.equal(solutionDocumentError('pdf_page_budget'), LEARNING_COPY.image_count);
});

test('selected attachment batch exceeding total page budget is rejected without truncation', async () => {
  const item = photo('budget', 'draft');
  const s = setup([item]);
  await s.init();
  const files = Array.from({ length: 4 }, (_, index) => ({
    name: `page-${index}.pdf`,
    type: 'application/pdf',
    size: 10,
  }));
  await s.render().upload(item.id, files);
  assert.deepEqual(s.documentsUploaded, []);
  assert.deepEqual(s.uploaded, []);
  assert.equal(s.render().error, s.load('@/config/integration').LEARNING_COPY.image_count);
});
