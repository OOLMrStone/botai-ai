import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

process.env.NEXT_PUBLIC_API_MOCK = '0';

const { expertWorkFromDto, expertTaskToCanonical } = await import('@/lib/expert-adapter');
const { fetchExpertSession, fetchExpertWorkspace, saveExpertTask, ExpertPartialSaveError } =
  await import('@/lib/api/expert');
const { validateExpertTask, supportsExpertFindingDeductions, validateExpertFindingDeduction } =
  await import('@/lib/expert');

const session = {
  id: 'expert-1',
  name: 'Эксперт',
  email: 'expert@example.test',
  initials: 'Э',
  mode: 'live',
};
const student = {
  id: 'student-1',
  firstName: 'Петя',
  lastName: 'Васечкин',
  email: 'student@example.test',
  contact: null,
};
const source = { image_id: 'image-1', bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } };
const block = (id, content, status = null, follows = []) => ({
  id,
  content,
  status,
  comment: null,
  sources: [source],
  follows_from_block_ids: follows,
});
const flatReview = {
  schema_version: 'expert-review.v1',
  origin: 'legacy_adapter',
  phase: 'graded',
  solution_image_ids: ['image-1', 'image-2'],
  blocks: [
    block('ocr', { type: 'text', text: 'Исходное решение\nбез изменения пробелов' }),
    block('math', { type: 'math', latex: 'x^2=4' }, 'error'),
    block(
      'line',
      {
        type: 'number_line',
        axis_label: 'x',
        points: [
          { id: 'p1', value: 0, label_latex: '0', marker: null, sign: 'unknown' },
          { id: 'p2', value: 2, label_latex: '\\sqrt{4}', marker: 'open', sign: 'undefined' },
        ],
        intervals: [
          { left_point_id: null, right_point_id: 'p1', sign: '+', selected: false },
          { left_point_id: 'p1', right_point_id: 'p2', sign: 'unknown', selected: false },
          { left_point_id: 'p2', right_point_id: null, sign: '-', selected: true },
        ],
      },
      'follow_through',
      ['math'],
    ),
    block(
      'circle',
      {
        type: 'unit_circle',
        points: [{ id: 'a', angle_rad: Math.PI / 6, label_latex: '\\pi/6', marker: null }],
        arcs: [
          {
            from_point_id: 'a',
            to_point_id: 'a',
            direction: 'cw',
            full_circle: true,
            selected: false,
          },
        ],
      },
      'warning',
    ),
  ],
  findings: [
    {
      id: 'global',
      block_ids: [],
      kind: 'error',
      code: 'E1',
      description: 'Общая ошибка',
      where: 'В ответе',
      correct_version: 'x=2',
      advice: 'Проверь ответ',
    },
    {
      id: 'linked',
      block_ids: ['math', 'line'],
      kind: 'warning',
      code: null,
      description: 'Связанные шаги',
      where: null,
      correct_version: null,
      advice: 'Укажи связь',
    },
  ],
  summary: 'Полная рецензия',
  checks: {
    domain: null,
    transformations: { is_correct: false, reason: 'Ошибка' },
    completeness: { is_complete: true, reason: 'Записан ответ' },
  },
  student_answer: { text: '2', is_correct: false },
  strengths: ['Есть ход решения'],
  grading: { score: 1, criterion: 'Одна ошибка', explanation: 'Снижен один балл' },
  rejection_reason: null,
};
const review = {
  schema_version: flatReview.schema_version,
  origin: flatReview.origin,
  phase: flatReview.phase,
  solution_image_ids: flatReview.solution_image_ids,
  ocr: { blocks: flatReview.blocks.map(({ id, content, sources }) => ({ id, content, sources })) },
  analysis: {
    block_reviews: flatReview.blocks.map(({ id, status, comment, follows_from_block_ids }) => ({
      block_id: id,
      status,
      explanation: comment,
      follows_from_block_ids,
    })),
    summary: flatReview.summary,
    checks: flatReview.checks,
    student_answer: flatReview.student_answer,
    strengths: flatReview.strengths,
    findings: flatReview.findings,
  },
  grading: flatReview.grading,
  rejection_reason: flatReview.rejection_reason,
};
const workDto = {
  id: 'work-1',
  submissionId: 'submission-1',
  student,
  taskNumber: 16,
  maxScore: 2,
  isDemo: false,
  status: 'queued',
  revision: 4,
  createdAt: '2026-10-13T10:00:00Z',
  updatedAt: '2026-10-13T10:00:00Z',
  task: {
    statement: 'x^2=4',
    content: null,
    referenceAnswer: '-2; 2',
    referenceSolution: 'Решение',
  },
  images: [
    {
      id: 'image-1',
      fileName: 'first.jpg',
      mimeType: 'image/jpeg',
      previewUrl: '/api/expert/works/work-1/images/image-1',
    },
    {
      id: 'image-2',
      fileName: 'second.jpg',
      mimeType: 'image/jpeg',
      previewUrl: '/api/expert/works/work-1/images/image-2',
    },
  ],
  aiResult: review,
  review,
  sentAt: null,
};

beforeEach(() => {
  globalThis.sessionStorage = { getItem: () => null };
  globalThis.document = { cookie: 'XSRF-TOKEN=token' };
});

test('canonical document round-trips with null statuses, all photos, global findings, references and provenance', () => {
  const work = expertWorkFromDto(workDto);
  const task = work.tasks[0];
  assert.equal(task.blocks[0].status, null);
  assert.equal(task.analysis.summary, review.analysis.summary);
  assert.equal(task.sourceImages.length, 2);
  assert.equal(task.analysis.findings[0].blockId, '');
  assert.equal(validateExpertTask(task), null);
  assert.deepEqual(expertTaskToCanonical(task), { ...review, origin: 'expert' });
});

test('PDF original remains separate from JPEG pages and canonical image IDs', async () => {
  const { expertSources } = await import('@/lib/expert-source');
  const document = {
    id: 'document-1',
    fileName: 'Решение.pdf',
    mimeType: 'application/pdf',
    state: 'ready',
    downloadUrl: '/api/expert/works/work-1/documents/document-1',
  };
  const images = workDto.images.map((image, index) => ({
    ...image,
    fileName: 'photo.pdf',
    mimeType: 'image/jpeg',
    sourceDocumentId: document.id,
    pageNumber: index + 1,
  }));
  const task = expertWorkFromDto({ ...workDto, images, documents: [document] }).tasks[0];
  const sources = expertSources(task);

  assert.equal(sources.length, 2);
  assert.equal(sources[0].mimeType, 'image/jpeg');
  assert.equal(sources[0].url, images[0].previewUrl);
  assert.equal(sources[0].pageNumber, 1);
  assert.equal(sources[1].pageNumber, 2);
  assert.deepEqual(sources[0].originalDocument, {
    id: document.id,
    name: document.fileName,
    mimeType: document.mimeType,
    downloadUrl: document.downloadUrl,
  });
  assert.deepEqual(expertTaskToCanonical(task).solution_image_ids, review.solution_image_ids);
  assert.deepEqual(expertSources({ sourceImage: null }), []);
  assert.equal(expertSources({ sourceImage: '/photo.jpg' })[0].url, '/photo.jpg');
  const photo = expertWorkFromDto(workDto).tasks[0].sourceImages[0];
  assert.equal(photo.originalDocument, undefined);
});

test('editing one field does not discard invisible canonical data and preserves immutable AI snapshot', () => {
  const task = expertWorkFromDto(workDto).tasks[0];
  task.blocks[0].text = 'Правка OCR';
  task.blocks[2].explanation = 'Уточнён комментарий';
  task.analysis.score = 2;
  const document = expertTaskToCanonical(task);
  assert.equal(document.ocr.blocks[0].content.text, 'Правка OCR');
  assert.deepEqual(document.ocr.blocks[0].sources, review.ocr.blocks[0].sources);
  assert.deepEqual(document.ocr.blocks[2].content, review.ocr.blocks[2].content);
  assert.deepEqual(document.analysis.block_reviews[2].follows_from_block_ids, ['math']);
  assert.deepEqual(document.analysis.findings, review.analysis.findings);
  assert.deepEqual(document.analysis.checks, review.analysis.checks);
  assert.deepEqual(document.analysis.student_answer, review.analysis.student_answer);
  assert.deepEqual(document.analysis.strengths, review.analysis.strengths);
  assert.equal(document.grading.score, 2);
  assert.equal(review.grading.score, 1);
  assert.equal(review.ocr.blocks[0].content.text, 'Исходное решение\nбез изменения пробелов');
});

test('math row additions serialize as a rendered multi-line expression', () => {
  const task = expertWorkFromDto(workDto).tasks[0];
  task.blocks[1].formulas = ['x^2=4', 'x=2'];
  assert.equal(
    expertTaskToCanonical(task).ocr.blocks[1].content.latex,
    '\\begin{gathered}x^2=4\\\\x=2\\end{gathered}',
  );
});

test('circle arcs preserve endpoint identity for coincident points and reject dangling explicit references', () => {
  const document = structuredClone(review);
  document.ocr.blocks[3].content = {
    type: 'unit_circle',
    points: [
      { id: 'a', angle_rad: 0, label_latex: 'A', marker: 'closed' },
      { id: 'b', angle_rad: 0, label_latex: 'B', marker: 'open' },
      { id: 'c', angle_rad: Math.PI, label_latex: 'C', marker: null },
    ],
    arcs: [
      {
        from_point_id: 'a',
        to_point_id: 'c',
        direction: 'ccw',
        full_circle: false,
        selected: false,
      },
      { from_point_id: 'b', to_point_id: 'b', direction: 'cw', full_circle: true, selected: true },
    ],
  };
  const task = expertWorkFromDto({ ...workDto, review: document }).tasks[0];
  const circle = task.blocks[3].circle;
  assert.equal(circle.arcs[1].fullCircle, true);
  assert.equal(circle.arcs[1].fromPointId, 'b');
  circle.arcs[0].fromPointId = 'b';
  const changed = expertTaskToCanonical(task).ocr.blocks[3].content;
  assert.equal(changed.arcs[0].from_point_id, 'b');
  assert.equal(changed.arcs[0].full_circle, false);
  assert.deepEqual(changed.arcs[1], document.ocr.blocks[3].content.arcs[1]);
  circle.points.find((point) => point.id === 'a').angle = Math.PI / 4;
  assert.equal(expertTaskToCanonical(task).ocr.blocks[3].content.arcs[0].from_point_id, 'b');
  circle.points = circle.points.filter((point) => point.id !== 'b');
  assert.throws(() => expertTaskToCanonical(task), { status: 422 });
});

test('expert analysis of OCR advances only analysis phase and never invents a grade or rewrites OCR', () => {
  const ocr = structuredClone(review);
  ocr.phase = 'ocr';
  ocr.grading = null;
  ocr.analysis = {
    block_reviews: ocr.ocr.blocks.map(({ id }) => ({
      block_id: id,
      status: null,
      explanation: null,
      follows_from_block_ids: [],
    })),
    summary: null,
    checks: null,
    student_answer: null,
    strengths: [],
    findings: [],
  };
  const task = expertWorkFromDto({ ...workDto, review: ocr }).tasks[0];
  assert.equal(expertTaskToCanonical(task).phase, 'ocr');
  task.blocks[0].status = 'correct';
  const analyzed = expertTaskToCanonical(task);
  assert.equal(analyzed.phase, 'analysis');
  assert.equal(analyzed.grading, null);
  assert.deepEqual(analyzed.ocr, ocr.ocr);
});

test('moving a finding preserves secondary references and review marker across canonical serialization', async () => {
  const { EXPERT_FINDING_REVIEW } = await import('@/config/expert-causality');
  const { expertFindingNeedsReview } = await import('@/lib/expert');
  const task = expertWorkFromDto(workDto).tasks[0];
  task.analysis.findings[1].blockId = 'circle';
  task.analysis.findings[1].title = EXPERT_FINDING_REVIEW.title;
  const document = expertTaskToCanonical(task);
  assert.deepEqual(document.analysis.findings[1].block_ids, ['circle', 'line']);
  const restored = expertWorkFromDto({ ...workDto, review: document }).tasks[0];
  assert.equal(expertFindingNeedsReview(restored, restored.analysis.findings[1]), true);
  assert.deepEqual(review.analysis.findings[1].block_ids, ['math', 'line']);
});

test('rejected AI review remains ungraded with null grading when expert confirms rejection', () => {
  const rejected = {
    ...review,
    phase: 'rejected',
    ocr: null,
    analysis: null,
    grading: null,
    rejection_reason: 'Фото размыто',
  };
  const task = expertWorkFromDto({ ...workDto, review: rejected }).tasks[0];
  assert.equal(task.analysis.rejectedReason, 'Фото размыто');
  assert.equal(validateExpertTask(task), null);
  assert.deepEqual(expertTaskToCanonical(task), { ...rejected, origin: 'expert' });
});

test('sent work cannot be modified and follow-through requires a cause', () => {
  const task = expertWorkFromDto({ ...workDto, status: 'sent' }).tasks[0];
  assert.equal(task.readOnly, true);
  assert.throws(() => expertTaskToCanonical(task), { status: 409 });
  const editable = expertWorkFromDto(workDto).tasks[0];
  editable.blocks[0].status = 'follow_through';
  assert.throws(() => expertTaskToCanonical(editable), { status: 422 });
});

test('real workspace follows pagination and fetches typed work details', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    if (url === '/api/expert/students?limit=50')
      return Response.json({ items: [student], nextCursor: '1' });
    if (url === '/api/expert/students?limit=50&cursor=1')
      return Response.json({ items: [], nextCursor: null });
    if (url === '/api/expert/works?limit=50')
      return Response.json({ items: [{ id: workDto.id }], nextCursor: null });
    if (url === '/api/expert/works/work-1') return Response.json(workDto);
    throw new Error(`Unexpected URL: ${url}`);
  });
  const data = await fetchExpertWorkspace(session);
  assert.equal(data.students.length, 1);
  assert.equal(data.works[0].tasks.length, 1);
  assert.equal(urls.includes('/api/expert/students?limit=50&cursor=1'), true);
});

test('revoked detail is omitted without hiding other works or unrelated endpoint failures', async (t) => {
  let failure = 404;
  let listFailure = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/expert/students?limit=50')
      return Response.json({ items: [student], nextCursor: null });
    if (url === '/api/expert/works?limit=50') {
      if (listFailure) return Response.json({ detail: 'Missing route' }, { status: 404 });
      return Response.json({ items: [{ id: 'revoked' }, { id: workDto.id }], nextCursor: null });
    }
    if (url === '/api/expert/works/revoked')
      return Response.json({ detail: 'Revoked work' }, { status: failure });
    if (url === `/api/expert/works/${workDto.id}`) return Response.json(workDto);
    throw new Error(`Unexpected URL: ${url}`);
  });
  const data = await fetchExpertWorkspace(session);
  assert.deepEqual(
    data.works.map((work) => work.id),
    [workDto.id],
  );
  for (failure of [401, 403, 500, 503])
    await assert.rejects(fetchExpertWorkspace(session), { status: failure });
  listFailure = true;
  await assert.rejects(fetchExpertWorkspace(session), { status: 404 });
});

test('expert errors hide internal server details but retain known actionable conflict and validation copy', async () => {
  const { expertErrorMessage } = await import('@/lib/api/expert');
  const { ApiError } = await import('@/lib/api/client');
  const { EXPERT_COPY, EXPERT_API_ERRORS } = await import('@/config/expert');
  const raw = 'SQLException SELECT private_value FROM internal_table';
  assert.equal(expertErrorMessage(new ApiError(500, raw)), EXPERT_COPY.errors.request);
  assert.equal(expertErrorMessage(new Error(raw)), EXPERT_COPY.errors.request);
  assert.equal(
    expertErrorMessage(new ApiError(409, raw, 'revision_conflict')),
    EXPERT_API_ERRORS.revision_conflict,
  );
  assert.equal(
    expertErrorMessage(new ApiError(422, EXPERT_COPY.errors.score)),
    EXPERT_COPY.errors.score,
  );
  assert.equal(expertErrorMessage(new ApiError(401, raw)), EXPERT_COPY.errors.session);
  assert.equal(expertErrorMessage(new ApiError(403, raw)), EXPERT_COPY.errors.role);
});

test('real draft uses shared cookie/CSRF transport, expectedRevision and full canonical document', async (t) => {
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    captured = { url, init };
    return Response.json({
      ...workDto,
      status: 'draft',
      revision: 5,
      review: { ...review, origin: 'expert' },
    });
  });
  const task = expertWorkFromDto(workDto).tasks[0];
  const result = await saveExpertTask(session, workDto.id, task, false);
  assert.equal(captured.url, '/api/expert/works/work-1/draft');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(captured.init.credentials, 'include');
  assert.equal(captured.init.headers.get('X-XSRF-TOKEN'), 'token');
  assert.deepEqual(JSON.parse(captured.init.body), {
    expectedRevision: 4,
    document: { ...review, origin: 'expert' },
  });
  assert.equal(result.tasks[0].revision, 5);
});

test('live auth validates expert membership and never falls back to demo on failures', async (t) => {
  globalThis.sessionStorage = { getItem: () => 'demo-expert' };
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/auth/me')
      return Response.json({
        id: 'expert-1',
        email: session.email,
        displayName: 'Эксперт',
        role: 'EXPERT',
        authProvider: 'LOCAL',
      });
    if (url === '/api/expert/me')
      return Response.json({ detail: 'Membership disabled' }, { status: 403 });
    throw new Error(`Unexpected URL: ${url}`);
  });
  await assert.rejects(fetchExpertSession(), { status: 403 });
  assert.equal(fetchMock.mock.callCount(), 2);
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ detail: 'Service unavailable' }, { status: 503 }),
  );
  await assert.rejects(fetchExpertWorkspace(session), { status: 503 });
});

test('manual score updates leave OCR and analysis structurally identical', () => {
  const task = expertWorkFromDto(workDto).tasks[0];
  task.analysis.score = 2;
  task.analysis.verdict = 'Эксперт пересмотрел оценку';
  const result = expertTaskToCanonical(task);
  assert.deepEqual(result.ocr, review.ocr);
  assert.deepEqual(result.analysis, review.analysis);
  assert.equal(result.grading.score, 2);
});

test('OCR edits do not clear analysis or invent a grade for OCR phase', () => {
  const analysis = {
    block_reviews: review.analysis.block_reviews.map((entry) => ({
      ...entry,
      status: null,
      explanation: null,
      follows_from_block_ids: [],
    })),
    findings: [],
    summary: null,
    checks: null,
    student_answer: null,
    strengths: [],
  };
  const initial = { ...review, phase: 'ocr', analysis, grading: null };
  const task = expertWorkFromDto({ ...workDto, review: initial }).tasks[0];
  task.blocks[0].text = 'Исправленное распознавание';
  const result = expertTaskToCanonical(task);
  assert.equal(task.analysis.hasGrade, false);
  assert.equal(result.phase, 'ocr');
  assert.equal(result.grading, null);
  assert.deepEqual(result.analysis, analysis);
});

test('block reviews are matched by stable ID and missing or repeated references are rejected', () => {
  const shuffled = {
    ...review,
    analysis: { ...review.analysis, block_reviews: [...review.analysis.block_reviews].reverse() },
  };
  const task = expertWorkFromDto({ ...workDto, review: shuffled }).tasks[0];
  assert.equal(task.blocks[1].status, 'error');
  assert.equal(task.blocks[2].status, 'follow_through');
  assert.deepEqual(expertTaskToCanonical(task), { ...shuffled, origin: 'expert' });
  assert.throws(() => expertWorkFromDto({ ...workDto, review: flatReview }), { status: 502 });
  assert.throws(
    () =>
      expertWorkFromDto({
        ...workDto,
        review: {
          ...review,
          analysis: { ...review.analysis, block_reviews: review.analysis.block_reviews.slice(1) },
        },
      }),
    { status: 502 },
  );
  assert.throws(
    () =>
      expertWorkFromDto({
        ...workDto,
        review: {
          ...review,
          analysis: {
            ...review.analysis,
            block_reviews: review.analysis.block_reviews.map(
              () => review.analysis.block_reviews[0],
            ),
          },
        },
      }),
    { status: 502 },
  );
});

test('explicit manual score uses manual-grade endpoint and approval uses its new revision', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({
      ...workDto,
      status: url.endsWith('/send') ? 'sent' : 'draft',
      revision: url.endsWith('/send') ? 6 : 5,
      gradingStale: false,
      review: { ...review, origin: 'expert' },
    });
  });
  const task = expertWorkFromDto(workDto).tasks[0];
  task.manualGradePending = true;
  await saveExpertTask(session, workDto.id, task, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/api/expert/works/work-1/manual-grade', '/api/expert/works/work-1/send'],
  );
  assert.deepEqual(
    calls.map((call) => call.body.expectedRevision),
    [4, 5],
  );
});

test('failed send retains accepted manual grade and retries only send at the saved revision', async (t) => {
  const calls = [];
  let server = structuredClone(workDto);
  let failSend = true;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'GET') return Response.json(server);
    const body = JSON.parse(init.body);
    calls.push({ action: url.split('/').at(-1), revision: body.expectedRevision });
    if (body.expectedRevision !== server.revision)
      return Response.json({ code: 'revision_conflict' }, { status: 409 });
    if (url.endsWith('/send') && failSend) throw new TypeError('Send unavailable');
    server = {
      ...server,
      revision: server.revision + 1,
      review: body.document,
      status: url.endsWith('/send') ? 'sent' : 'draft',
      gradingStale: false,
    };
    return Response.json(server);
  });
  const task = expertWorkFromDto(workDto).tasks[0];
  task.manualGradePending = true;
  let partial;
  await assert.rejects(saveExpertTask(session, workDto.id, task, true), (error) => {
    assert.ok(error instanceof ExpertPartialSaveError);
    partial = error.savedWork;
    assert.match(error.message, /отправка не завершена/);
    return true;
  });
  assert.equal(partial.tasks[0].revision, 5);
  assert.equal(partial.tasks[0].manualGradePending, undefined);
  assert.equal(partial.tasks[0].approved, false);
  failSend = false;
  const sent = await saveExpertTask(session, workDto.id, partial.tasks[0], true);
  assert.equal(sent.tasks[0].readOnly, true);
  assert.deepEqual(calls, [
    { action: 'manual-grade', revision: 4 },
    { action: 'send', revision: 5 },
    { action: 'send', revision: 5 },
  ]);
});

test('lost manual-grade or send response recovers the exact durable result without repeating writes', async (t) => {
  for (const lostAction of ['manual-grade', 'send']) {
    const writes = [];
    let reads = 0;
    let server = structuredClone(workDto);
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      if (init.method === 'GET') {
        reads += 1;
        return Response.json(server);
      }
      const action = url.split('/').at(-1);
      const body = JSON.parse(init.body);
      writes.push(action);
      assert.equal(body.expectedRevision, server.revision);
      server = {
        ...server,
        revision: server.revision + 1,
        review: body.document,
        status: action === 'send' ? 'sent' : 'draft',
        gradingStale: false,
      };
      if (action === lostAction) throw new TypeError('Response connection lost');
      return Response.json(server);
    });
    const task = expertWorkFromDto(workDto).tasks[0];
    task.manualGradePending = true;
    const result = await saveExpertTask(session, workDto.id, task, true);
    assert.equal(result.tasks[0].readOnly, true);
    assert.equal(result.tasks[0].revision, 6);
    assert.deepEqual(writes, ['manual-grade', 'send']);
    assert.equal(reads, 1);
    t.mock.restoreAll();
  }
});

test('lost write cannot be reported as sent when the server saved different review data', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') throw new TypeError('Response connection lost');
    return Response.json({
      ...workDto,
      revision: 5,
      status: 'sent',
      review: { ...review, origin: 'expert', grading: { ...review.grading, score: 2 } },
    });
  });
  await assert.rejects(
    saveExpertTask(session, workDto.id, expertWorkFromDto(workDto).tasks[0], true),
    TypeError,
  );
});

test('grading-only retries use the same idempotency key and reject changed OCR or analysis', async (t) => {
  const { gradeExpertTask } = await import('@/lib/api/expert');
  const calls = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    throw new TypeError('Network interrupted');
  });
  const task = expertWorkFromDto(workDto).tasks[0];
  await assert.rejects(gradeExpertTask(session, workDto.id, task), TypeError);
  fetchMock.mock.mockImplementation(async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      ...workDto,
      revision: 6,
      gradingStale: false,
      gradeJob: {
        id: 'job-1',
        state: 'succeeded',
        baseRevision: 4,
        preparedRevision: 5,
        appliedRevision: 6,
      },
      review: { ...review, origin: 'expert', grading: { ...review.grading, score: 2 } },
    });
  });
  const graded = await gradeExpertTask(session, workDto.id, task);
  assert.equal(graded.tasks[0].analysis.score, 2);
  assert.equal(calls[0].url, '/api/expert/works/work-1/grade');
  assert.equal(
    calls[0].init.headers.get('Idempotency-Key'),
    calls.findLast((call) => call.init.method === 'POST').init.headers.get('Idempotency-Key'),
  );
  assert.equal(Boolean(calls[0].init.headers.get('Idempotency-Key')), true);
  fetchMock.mock.mockImplementation(async () =>
    Response.json({
      ...workDto,
      review: { ...review, analysis: { ...review.analysis, summary: 'Нельзя менять анализ' } },
    }),
  );
  await assert.rejects(gradeExpertTask(session, workDto.id, task), { status: 502 });
});

test('lost grading HTTP response recovers the durable pending job without another model command', async (t) => {
  const { gradeExpertTask } = await import('@/lib/api/expert');
  const commands = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    commands.push({ url, method: init.method });
    if (init.method === 'POST') throw new TypeError('Response connection lost');
    return Response.json({
      ...workDto,
      revision: 5,
      gradingStale: true,
      gradeJob: { id: 'recover-job', state: 'pending', baseRevision: 4, preparedRevision: 5 },
      review: { ...review, origin: 'expert' },
    });
  });
  const task = expertWorkFromDto(workDto).tasks[0];
  const recovered = await gradeExpertTask(session, workDto.id, task);
  assert.equal(recovered.tasks[0].gradingJob.state, 'pending');
  assert.equal(recovered.tasks[0].analysis.gradeStale, true);
  assert.deepEqual(commands, [
    { url: '/api/expert/works/work-1/grade', method: 'POST' },
    { url: '/api/expert/works/work-1', method: 'GET' },
  ]);
});

function structuredWork() {
  const dto = structuredClone(workDto);
  dto.review.schema_version = 'expert-review.v2';
  dto.review.origin = 'structured_ai';
  dto.review.ocr.blocks[1] = {
    id: 'math',
    title: 'Чертёж и вычисление',
    sources: [source],
    content: {
      type: 'step',
      lines: ['$AB=3$', 'Проведём высоту $CH$'],
      image: { type: 'image', artifact_id: 'diagram-1', alt: 'Чертёж ученика' },
    },
  };
  dto.imageArtifacts = [
    {
      id: 'diagram-1',
      mimeType: 'image/jpeg',
      previewUrl: '/api/expert/works/work-1/artifacts/diagram-1',
      width: 800,
      height: 500,
    },
  ];
  return dto;
}

test('v2 keeps text, diagram, title and causal identity in one review block', () => {
  const dto = structuredWork();
  const task = expertWorkFromDto(dto).tasks[0];
  const step = task.blocks[1];
  assert.equal(step.kind, 'step');
  assert.equal(step.title, 'Чертёж и вычисление');
  assert.deepEqual(step.lines, dto.review.ocr.blocks[1].content.lines);
  assert.equal(step.image.url, dto.imageArtifacts[0].previewUrl);
  const saved = expertTaskToCanonical(task);
  assert.equal(saved.schema_version, 'expert-review.v2');
  assert.deepEqual(saved.ocr, dto.review.ocr);
  assert.deepEqual(saved.analysis.block_reviews, dto.review.analysis.block_reviews);
  assert.doesNotMatch(JSON.stringify(saved), /previewUrl|width":800/);
});

test('optional blank canonical titles use a display fallback without changing the saved title', () => {
  for (const title of ['', '   ']) {
    const dto = structuredWork();
    dto.review.ocr.blocks[1].title = title;
    const task = expertWorkFromDto(dto).tasks[0];
    assert.equal(task.blocks[1].title, 'Шаг 2');
    assert.equal(validateExpertTask(task), null);
    assert.equal(expertTaskToCanonical(task).ocr.blocks[1].title, title);
    task.blocks[1].explanation = 'Комментарий эксперта';
    assert.equal(expertTaskToCanonical(task).ocr.blocks[1].title, title);
    task.blocks[1].title = 'Уточнённый шаг';
    assert.equal(expertTaskToCanonical(task).ocr.blocks[1].title, 'Уточнённый шаг');
  }
});

test('editing one line of a combined step preserves its crop and source provenance', () => {
  const dto = structuredWork();
  const task = expertWorkFromDto(dto).tasks[0];
  task.blocks[1].lines[0] = '$AB=4$';
  const saved = expertTaskToCanonical(task);
  assert.deepEqual(saved.ocr.blocks[1].sources, [source]);
  assert.deepEqual(saved.ocr.blocks[1].content.image, dto.review.ocr.blocks[1].content.image);
  assert.deepEqual(saved.ocr.blocks[1].content.lines, ['$AB=4$', 'Проведём высоту $CH$']);
  assert.equal(dto.review.ocr.blocks[1].content.lines[0], '$AB=3$');
});

test('a figure-only step remains reviewable without fabricating OCR text', () => {
  const dto = structuredWork();
  dto.review.ocr.blocks[1].content.lines = [];
  const task = expertWorkFromDto(dto).tasks[0];
  assert.deepEqual(expertTaskToCanonical(task).ocr.blocks[1].content.lines, []);
  assert.equal(validateExpertTask(task), null);
});

test('unresolved or external image artifacts never become model-controlled image URLs', () => {
  for (const previewUrl of [
    'https://example.test/crop.jpg',
    '//example.test/crop.jpg',
    '/api/../private',
  ]) {
    const dto = structuredWork();
    dto.imageArtifacts[0].previewUrl = previewUrl;
    assert.equal(expertWorkFromDto(dto).tasks[0].blocks[1].image.url, null);
  }
  const dto = structuredWork();
  dto.imageArtifacts = [];
  const task = expertWorkFromDto(dto).tasks[0];
  assert.equal(task.blocks[1].image.url, null);
  assert.deepEqual(
    expertTaskToCanonical(task).ocr.blocks[1].content.image,
    dto.review.ocr.blocks[1].content.image,
  );
});

test('malformed structured lines fail before entering the editor', () => {
  for (const lines of ['not an array', [42], []]) {
    const dto = structuredWork();
    dto.review.ocr.blocks[1].content = { type: 'step', lines };
    assert.throws(() => expertWorkFromDto(dto), { status: 502 });
  }
});

function structuredDiagramWork(type) {
  const dto = structuredWork();
  dto.review.ocr.blocks[1].content = {
    type: 'step',
    lines: ['$t=2^x$', 'Отметим решение на рисунке'],
    diagram: structuredClone(
      review.ocr.blocks.find((block) => block.content.type === type).content,
    ),
  };
  return dto;
}

test('nested diagrams roundtrip under the same step identity, title, sources and causal review', () => {
  for (const type of ['number_line', 'unit_circle']) {
    const dto = structuredDiagramWork(type);
    const task = expertWorkFromDto(dto).tasks[0];
    const step = task.blocks[1];
    assert.equal(step.kind, 'step');
    assert.equal(step.id, 'math');
    assert.equal(step.diagram.kind, type);
    assert.equal('id' in step.diagram, false);
    assert.equal(validateExpertTask(task), null);
    const saved = expertTaskToCanonical(task);
    assert.deepEqual(saved.ocr, dto.review.ocr);
    assert.deepEqual(saved.analysis, dto.review.analysis);

    step.lines[0] = '$t=3^x$';
    const textChanged = expertTaskToCanonical(task);
    assert.deepEqual(textChanged.ocr.blocks[1], {
      ...dto.review.ocr.blocks[1],
      content: { ...dto.review.ocr.blocks[1].content, lines: step.lines },
    });
    assert.deepEqual(textChanged.analysis.block_reviews, dto.review.analysis.block_reviews);
  }
});

test('editing nested number line preserves step text, source and review links', () => {
  const dto = structuredDiagramWork('number_line');
  const task = expertWorkFromDto(dto).tasks[0];
  const step = task.blocks[1];
  step.diagram.axis.points[1].value = 3;
  step.diagram.axis.intervals[1].to = 3;
  step.diagram.axis.intervals[2].from = 3;
  const saved = expertTaskToCanonical(task);
  const expected = structuredClone(dto.review.ocr.blocks[1]);
  expected.content.diagram.points[1].value = 3;
  assert.deepEqual(saved.ocr.blocks[1], expected);
  assert.deepEqual(saved.analysis.block_reviews, dto.review.analysis.block_reviews);
  assert.deepEqual(saved.analysis.findings, dto.review.analysis.findings);
  assert.equal(dto.review.ocr.blocks[1].content.diagram.points[1].value, 2);
});

test('optional empty point labels remain valid canonical geometry without fabricated labels', () => {
  for (const type of ['number_line', 'unit_circle']) {
    const dto = structuredDiagramWork(type);
    dto.review.ocr.blocks[1].content.diagram.points[0].label_latex = '';
    const task = expertWorkFromDto(dto).tasks[0];
    assert.equal(validateExpertTask(task), null);
    assert.deepEqual(expertTaskToCanonical(task).ocr, dto.review.ocr);
  }
});

test('editing nested circle retains point identity and full-circle semantics', () => {
  const dto = structuredDiagramWork('unit_circle');
  const task = expertWorkFromDto(dto).tasks[0];
  const step = task.blocks[1];
  step.diagram.circle.points[0].angle = Math.PI;
  step.diagram.circle.arcs[0].from = Math.PI;
  step.diagram.circle.arcs[0].to = Math.PI;
  const saved = expertTaskToCanonical(task);
  const expected = structuredClone(dto.review.ocr.blocks[1]);
  expected.content.diagram.points[0].angle_rad = Math.PI;
  assert.deepEqual(saved.ocr.blocks[1], expected);
  assert.deepEqual(saved.analysis, dto.review.analysis);
  assert.equal(saved.ocr.blocks[1].content.diagram.arcs[0].full_circle, true);
});

test('diagram-only steps need no fabricated text and can replace an image explicitly', () => {
  for (const type of ['number_line', 'unit_circle']) {
    const dto = structuredDiagramWork(type);
    dto.review.ocr.blocks[1].content.lines = [];
    const task = expertWorkFromDto(dto).tasks[0];
    assert.equal(validateExpertTask(task), null);
    assert.deepEqual(expertTaskToCanonical(task).ocr, dto.review.ocr);

    const imageTask = expertWorkFromDto(structuredWork()).tasks[0];
    imageTask.blocks[1].image = undefined;
    imageTask.blocks[1].diagram = task.blocks[1].diagram;
    const saved = expertTaskToCanonical(imageTask);
    assert.equal('image' in saved.ocr.blocks[1].content, false);
    assert.equal(saved.ocr.blocks[1].content.diagram.type, type);
    assert.deepEqual(saved.ocr.blocks[1].content.lines, imageTask.blocks[1].lines);
    assert.deepEqual(saved.ocr.blocks[1].sources, dto.review.ocr.blocks[1].sources);
  }
});

test('nested geometry rejects image conflicts, unknown diagrams and non-finite values', () => {
  const conflict = structuredDiagramWork('number_line');
  conflict.review.ocr.blocks[1].content.image = structuredWork().review.ocr.blocks[1].content.image;
  assert.throws(() => expertWorkFromDto(conflict), { status: 502 });
  const task = expertWorkFromDto(structuredDiagramWork('number_line')).tasks[0];
  task.blocks[1].image = { id: 'image-1', alt: '', url: null };
  assert.notEqual(validateExpertTask(task), null);
  assert.throws(() => expertTaskToCanonical(task), { status: 422 });

  for (const diagram of [
    null,
    { type: 'text', text: 'Не диаграмма' },
    { type: 'step', lines: [] },
  ]) {
    const dto = structuredDiagramWork('number_line');
    dto.review.ocr.blocks[1].content.diagram = diagram;
    assert.throws(() => expertWorkFromDto(dto), { status: 502 });
  }
  for (const type of ['number_line', 'unit_circle']) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const dto = structuredDiagramWork(type);
      const key = type === 'number_line' ? 'value' : 'angle_rad';
      dto.review.ocr.blocks[1].content.diagram.points[0][key] = value;
      assert.throws(() => expertWorkFromDto(dto), { status: 502 });
      const editable = expertWorkFromDto(structuredDiagramWork(type)).tasks[0];
      const geometry = editable.blocks[1].diagram;
      if (geometry.kind === 'number_line') geometry.axis.points[0].value = value;
      else geometry.circle.points[0].angle = value;
      assert.notEqual(validateExpertTask(editable), null);
      assert.throws(() => expertTaskToCanonical(editable), { status: 422 });
    }
  }
});

test('v2 penalties distinguish missing values from zero and preserve both on roundtrip', () => {
  const dto = structuredWork();
  dto.review.analysis.findings[0].penalty = 0;
  dto.review.analysis.findings[1].kind = 'error';
  dto.review.analysis.findings[1].penalty = 1;
  const task = expertWorkFromDto(dto).tasks[0];
  assert.equal(supportsExpertFindingDeductions(task), true);
  assert.deepEqual(
    task.analysis.findings.map((finding) => finding.deduction),
    [0, 1],
  );
  assert.deepEqual(expertTaskToCanonical(task).analysis.findings, dto.review.analysis.findings);

  task.analysis.findings[1].deduction = 0;
  const changed = expertTaskToCanonical(task);
  assert.equal(changed.analysis.findings[1].penalty, 0);
  assert.deepEqual(changed.ocr, dto.review.ocr);
  assert.deepEqual(changed.analysis.block_reviews, dto.review.analysis.block_reviews);
  task.analysis.findings[1].deduction = undefined;
  const cleared = expertTaskToCanonical(task);
  assert.equal('penalty' in cleared.analysis.findings[1], false);
  assert.equal(dto.review.analysis.findings[1].penalty, 1);
});

test('legacy findings keep unknown deductions absent and cannot gain v2 fields', () => {
  for (const dto of [workDto, structuredWork()]) {
    const task = expertWorkFromDto(dto).tasks[0];
    assert.ok(task.analysis.findings.every((finding) => finding.deduction === undefined));
    task.analysis.findings[0].description = 'Уточнённое описание';
    assert.ok(
      expertTaskToCanonical(task).analysis.findings.every((finding) => !('penalty' in finding)),
    );
  }
  const legacy = expertWorkFromDto(workDto).tasks[0];
  assert.equal(supportsExpertFindingDeductions(legacy), false);
  legacy.analysis.findings[0].deduction = 0;
  assert.notEqual(validateExpertTask(legacy), null);
  assert.throws(() => expertTaskToCanonical(legacy), { status: 422 });
  const invalidLegacy = structuredClone(workDto);
  invalidLegacy.review.analysis.findings[0].penalty = 0;
  assert.throws(() => expertWorkFromDto(invalidLegacy), { status: 502 });
  delete legacy.backend;
  assert.equal(supportsExpertFindingDeductions(legacy), true);
  assert.equal(validateExpertFindingDeduction(legacy, legacy.analysis.findings[0]), null);
});

test('penalties enforce integral score bounds at the incoming and outgoing boundaries', () => {
  for (const penalty of [null, -1, 0.5, 3, NaN, Infinity]) {
    const dto = structuredWork();
    dto.review.analysis.findings[1].penalty = penalty;
    assert.throws(() => expertWorkFromDto(dto), { status: 502 });
    const task = expertWorkFromDto(structuredWork()).tasks[0];
    task.analysis.findings[1].deduction = penalty;
    assert.notEqual(validateExpertTask(task), null);
    assert.throws(() => expertTaskToCanonical(task), { status: 422 });
  }
});

test('warnings and dependent errors cannot incur another positive penalty', () => {
  for (const patch of [{ kind: 'warning' }, { blockId: 'line' }, { blockId: 'circle' }]) {
    const task = expertWorkFromDto(structuredWork()).tasks[0];
    const finding = task.analysis.findings[1];
    Object.assign(finding, { kind: 'error' }, patch, { deduction: 1 });
    assert.notEqual(validateExpertFindingDeduction(task, finding), null);
    assert.throws(() => expertTaskToCanonical(task), { status: 422 });
    finding.deduction = 0;
    assert.equal(validateExpertFindingDeduction(task, finding), null);
    assert.equal(expertTaskToCanonical(task).analysis.findings[1].penalty, 0);
  }
  const dto = structuredWork();
  dto.review.analysis.findings[1].kind = 'error';
  dto.review.analysis.findings[1].block_ids = ['line'];
  dto.review.analysis.findings[1].penalty = 1;
  assert.throws(() => expertWorkFromDto(dto), { status: 502 });
});

test('grade-only diagnostic metadata survives work adaptation for failed jobs', () => {
  const failure = {
    category: 'provider',
    diagnosticCode: 501,
    reasonCode: 'provider_rate_limit',
    phase: 'grading',
    step: 'grading.expert',
    attempt: 4,
    maxAttempts: 4,
    failureCounts: { provider: 2, network: 2 },
    exhausted: true,
  };
  const work = expertWorkFromDto({
    ...workDto,
    gradeJob: {
      id: 'job',
      state: 'failed',
      baseRevision: 4,
      preparedRevision: 5,
      errorCode: 'llm_error',
      failure,
    },
  });
  assert.deepEqual(work.tasks[0].gradingJob.failure, failure);
});
