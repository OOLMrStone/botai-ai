import './register-typescript.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  matchesPersonalLayout,
  bindPersonalLayoutReview,
  projectPersonalLayout,
  personalLayoutSessionCookie,
} = await import('@/lib/personal-layout-fixture');
const { PERSONAL_LAYOUT_FIXTURE } = await import('@/config/personal-layout-fixture');
const { saveExpertTask } = await import('@/lib/api/expert');
const imageId = '00000000-0000-4000-8000-000000000001';
const document = () => ({
  schema_version: 'expert-review.v2',
  origin: 'expert',
  phase: 'graded',
  solution_image_ids: [],
  rejection_reason: null,
  ocr: {
    blocks: [{ id: 's1', title: 'Шаг', sources: [], content: { type: 'step', lines: ['$x=1$'] } }],
  },
  analysis: {
    block_reviews: [
      { block_id: 's1', status: 'correct', explanation: null, follows_from_block_ids: [] },
    ],
    findings: [],
    summary: 'Проверено',
    checks: null,
    student_answer: null,
    strengths: [],
  },
  grading: { score: 2, criterion: 'Критерий', explanation: 'Проверено' },
});
function context() {
  const ai = { ...document(), origin: 'structured_ai', solution_image_ids: [imageId] };
  ai.grading.score = 0;
  const work = {
    id: 'work',
    submissionId: 'submission',
    student: { id: 'student', firstName: 'Имя', lastName: 'Фамилия', email: null, contact: null },
    taskNumber: 16,
    maxScore: 2,
    isDemo: false,
    status: 'queued',
    revision: 0,
    gradingStale: false,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    sentAt: null,
    task: { statement: 'Условие', content: [], referenceAnswer: '1', referenceSolution: null },
    images: [
      { id: imageId, fileName: 'solution.jpg', mimeType: 'image/jpeg', previewUrl: '/private' },
    ],
    aiResult: ai,
    review: structuredClone(ai),
  };
  const manifest = {
    enabled: true,
    expectedImageCount: 1,
    expectedRevision: 0,
    studentId: 'student',
    assignmentId: 'exact-assignment',
    taskNumber: 16,
    maxScore: 2,
    normalizedImageSha256: 'a'.repeat(64),
  };
  const run = {
    origin: 'school',
    assignmentId: 'exact-assignment',
    submissionId: work.submissionId,
    workId: work.id,
    taskNumber: 16,
    errorCode: null,
    isDemo: false,
    state: 'awaiting_expert',
    aiResult: ai,
    images: work.images,
  };
  return { work, run, manifest };
}

test('only exact enabled assignment and sole normalized image hash match', () => {
  const { work, run, manifest } = context();
  assert.equal(matchesPersonalLayout(manifest, work, run, 'a'.repeat(64)), true);
  for (const change of [
    { enabled: false },
    { assignmentId: 'other' },
    { studentId: 'other' },
    { expectedImageCount: 2 },
    { expectedRevision: 1 },
    { taskNumber: 14 },
  ])
    assert.equal(
      matchesPersonalLayout({ ...manifest, ...change }, work, run, 'a'.repeat(64)),
      false,
    );
  assert.equal(matchesPersonalLayout(manifest, work, run, 'b'.repeat(64)), false);
  assert.equal(
    matchesPersonalLayout(
      manifest,
      { ...work, images: [...work.images, work.images[0]] },
      run,
      'a'.repeat(64),
    ),
    false,
  );
});

test('failure, rejection, mock, hand edits, revision and pending grade job never project', () => {
  for (const change of [
    { status: 'draft' },
    { status: 'sent' },
    { revision: 1 },
    { isDemo: true },
    { gradeJob: { state: 'pending' } },
    { review: { ...document(), solution_image_ids: [imageId] } },
    { aiResult: { ...document(), phase: 'rejected', grading: null } },
  ]) {
    const { work, run, manifest } = context();
    assert.equal(
      matchesPersonalLayout(manifest, { ...work, ...change }, run, 'a'.repeat(64)),
      false,
    );
  }
  for (const change of [
    { errorCode: 'unknown_after_dispatch' },
    { state: 'failed' },
    { state: 'returned' },
    { assignmentId: 'another-task' },
    { submissionId: 'another-upload' },
    { workId: 'another-work' },
  ]) {
    const { work, run, manifest } = context();
    assert.equal(
      matchesPersonalLayout(manifest, work, { ...run, ...change }, 'a'.repeat(64)),
      false,
    );
  }
});

test('binding clones private template and refuses foreign sources/artifacts', () => {
  const original = document();
  assert.deepEqual(bindPersonalLayoutReview(original, imageId).solution_image_ids, [imageId]);
  assert.deepEqual(original.solution_image_ids, []);
  const foreign = document();
  foreign.ocr.blocks[0].sources = [{ image_id: 'foreign', bbox: null }];
  assert.throws(() => bindPersonalLayoutReview(foreign, imageId));
});

test('editable prepared review writes only on explicit confirm, manual-grade then send', async () => {
  const { work } = context();
  const original = structuredClone(work);
  const review = bindPersonalLayoutReview(document(), imageId);
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const requests = [];
  globalThis.document = { cookie: 'XSRF-TOKEN=test' };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, method: init.method, body });
    const manual = String(url).endsWith('/manual-grade');
    return new Response(JSON.stringify({
      ...work,
      status: manual ? 'draft' : 'sent',
      revision: manual ? 1 : 2,
      gradingStale: false,
      sentAt: manual ? null : '2026-10-20T01:00:00Z',
      review: body.document,
    }), { status: 200 });
  };
  try {
    const projected = projectPersonalLayout(work, {
      workId: work.id, submissionId: work.submissionId, revision: 0, imageId, review,
    });
    const task = projected.tasks[0];
    assert.equal(task.analysis.score, 2);
    assert.equal(task.readOnly, false);
    assert.equal(task.manualGradePending, true);
    assert.equal(task.analysis.gradeStale, false);
    assert.deepEqual(work, original);
    assert.equal(work.aiResult.grading.score, 0);
    assert.equal(requests.length, 0);
    const sent = await saveExpertTask({ mode: 'live' }, work.id, task, true);
    assert.equal(requests.length, 2);
    assert.ok(requests[0].url.endsWith('/manual-grade'));
    assert.ok(requests[1].url.endsWith('/send'));
    assert.deepEqual(requests.map(({ body }) => body.expectedRevision), [0, 1]);
    assert.deepEqual(requests.map(({ method }) => method), ['POST', 'POST']);
    assert.equal(requests[0].body.document.origin, 'expert');
    assert.equal(requests[0].body.document.grading.score, 2);
    assert.deepEqual(requests[0].body.document.solution_image_ids, [imageId]);
    assert.equal(sent.tasks[0].readOnly, true);
    assert.deepEqual(work, original);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.document = previousDocument;
  }
  const persisted = { ...work, status: 'draft', revision: 1, review };
  const actual = projectPersonalLayout(persisted, {
    workId: work.id, submissionId: work.submissionId, revision: 0, imageId, review: document(),
  }).tasks[0];
  assert.equal(actual.analysis.score, 2);
  assert.equal(actual.revision, 1);
  assert.equal(actual.manualGradePending, undefined);
});

test('auth forwards only the actual local B2B session cookie', () => {
  assert.equal(
    personalLayoutSessionCookie('SESSION=public; B2B_SESSION=local%3D; XSRF-TOKEN=csrf'),
    'B2B_SESSION=local%3D',
  );
  assert.equal(personalLayoutSessionCookie('SESSION=public'), null);
  assert.equal(personalLayoutSessionCookie('B2B_SESSION=a; B2B_SESSION=b'), null);
  assert.equal(personalLayoutSessionCookie(null), null);
  assert.equal(personalLayoutSessionCookie('B2B_SESSION='), null);
});

test('run discovery respects the existing backend Page.limit upper bound', () => {
  assert.equal(PERSONAL_LAYOUT_FIXTURE.runLimit, 50);
  assert.ok(PERSONAL_LAYOUT_FIXTURE.maxRunPages <= 3);
});
