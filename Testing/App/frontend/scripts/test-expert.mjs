import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { moduleLoader } from './helpers/hook-harness.mjs';

const { EXPERT, EXPERT_COPY } = await import('@/config/expert');
const { EXPERIMENTAL } = await import('@/config/experimental');
const { EXPERT_MOCK_TASKS } = await import('@/config/expert-mock');
const { getExpertQueue, replaceExpertTask, validateExpertTask, expertTaskNeedsReview } =
  await import('@/lib/expert');
const { EXPERT_FINDING_REVIEW } = await import('@/config/expert-causality');
const { useExpertStore } = await import('@/stores/expert-store');
const { expertReviewStep } = await import('@/lib/expert-review');
const {
  enterExpertDemo,
  fetchExpertDemo,
  leaveExpertDemo,
  demoExpertSession,
  assignExpertDemoStudent,
  saveExpertDemoTask,
  approveExpertDemoWork,
} = await import('@/lib/api/expert-mock');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

beforeEach((t) => {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.document = { cookie: 'XSRF-TOKEN=token' };
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    queueMicrotask(callback);
    return 0;
  });
  useExpertStore.getState().reset();
});

test('demo starts anonymously and only explicit login grants access', async () => {
  assert.equal(demoExpertSession(), null);
  await assert.rejects(fetchExpertDemo(), { status: 401 });
  const session = await enterExpertDemo();
  assert.equal(session.mode, 'demo');
  assert.deepEqual(demoExpertSession(), session);
  const data = await fetchExpertDemo();
  assert.equal(data.students.length, 4);
  assert.equal(data.works.flatMap((work) => work.tasks).length, 16);
  assert.equal(new Set(data.works.flatMap((work) => work.tasks.map((task) => task.id))).size, 16);
  for (const work of data.works)
    for (const task of work.tasks) assert.equal(validateExpertTask(task), null);
  await leaveExpertDemo();
  assert.equal(demoExpertSession(), null);
  await assert.rejects(fetchExpertDemo(), { status: 401 });
});

test('assigning an existing student persists once and rejects unknown IDs', async () => {
  await enterExpertDemo();
  const updated = await assignExpertDemoStudent(' anna-smirnova ');
  assert.equal(updated.students.length, 5);
  assert.equal(updated.works.at(-1).tasks.length, 2);
  assert.equal((await fetchExpertDemo()).students.length, 5);
  await assert.rejects(assignExpertDemoStudent('anna-smirnova'), { status: 409 });
  await assert.rejects(assignExpertDemoStudent('unknown'), { status: 404 });
});

test('stored demo source numbering is corrected without resetting reviews or other task metadata', async () => {
  await enterExpertDemo();
  const data = await fetchExpertDemo();
  const draft = data.works[0].tasks[0];
  draft.blocks[0].explanation = 'Сохранённая правка эксперта';
  draft.analysis.advice = 'Сохранённый совет';
  draft.updatedByExpert = true;
  draft.revision = 7;
  const confirmed = data.works[1].tasks[0];
  confirmed.approved = true;
  confirmed.revision = 12;
  const expected = structuredClone(data);
  for (const work of data.works)
    for (const task of work.tasks)
      if (task.sourceImage === EXPERIMENTAL.sourceImage) task.number = 15;
  const stored = JSON.stringify({ ...data, version: EXPERT.storageVersion });
  localStorage.setItem(EXPERT.storageKey, stored);

  const restored = await fetchExpertDemo();

  assert.equal(EXPERIMENTAL.taskNumber, 16);
  assert.deepEqual(restored, { ...expected, version: EXPERT.storageVersion });
  assert.equal(restored.works[0].tasks[2].number, 15);
  assert.equal(localStorage.getItem(EXPERT.storageKey), stored);
});

test('editing a task persists every block and analysis while isolating other students', async () => {
  await enterExpertDemo();
  const original = await fetchExpertDemo();
  const work = original.works[0];
  const task = structuredClone(work.tasks[0]);
  task.blocks[0].formulas = ['x\\ne3'];
  task.blocks[0].status = 'warning';
  task.blocks[0].explanation = 'Уточнено экспертом';
  task.analysis.score = 2;
  task.analysis.verdict = 'Новая оценка';
  task.analysis.advice = 'Новый совет';
  task.updatedByExpert = true;
  const result = await saveExpertDemoTask(work.id, task, false);
  assert.equal(result.tasks[0].revision, task.revision + 1);
  assert.equal(result.tasks[0].approved, false);
  assert.equal(result.tasks[0].analysis.score, 2);
  const restored = await fetchExpertDemo();
  assert.deepEqual(restored.works[0], result);
  assert.deepEqual(restored.works.slice(1), original.works.slice(1));
  assert.deepEqual(restored.works[0].tasks.slice(1), original.works[0].tasks.slice(1));
  await leaveExpertDemo();
  await enterExpertDemo();
  assert.deepEqual((await fetchExpertDemo()).works[0], result);
  assert.equal(JSON.stringify(localStorage.getItem(EXPERT.storageKey)).includes('password'), false);
});

test('concurrent stale task saves fail instead of overwriting newer review', async () => {
  await enterExpertDemo();
  const { works } = await fetchExpertDemo();
  const work = works[0];
  const first = await saveExpertDemoTask(work.id, work.tasks[0], true);
  await assert.rejects(saveExpertDemoTask(work.id, work.tasks[0], false), { status: 409 });
  assert.deepEqual((await fetchExpertDemo()).works[0], first);
});

test('task approval leaves pending work until all tasks are approved and whole-work approval is atomic', async () => {
  await enterExpertDemo();
  const { works } = await fetchExpertDemo();
  const work = works[0];
  const partial = await saveExpertDemoTask(work.id, work.tasks[0], true);
  assert.equal(partial.status, 'pending');
  await assert.rejects(approveExpertDemoWork(work), { status: 409 });
  const reviewed = await approveExpertDemoWork(partial);
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(
    reviewed.tasks.every((task) => task.approved),
    true,
  );
  const next = replaceExpertTask(reviewed, { ...reviewed.tasks[0], approved: false });
  assert.equal(next.status, 'pending');
});

test('queue searches names and IDs, sorts either direction, and separates reviewed work', async () => {
  await enterExpertDemo();
  const { works } = await fetchExpertDemo();
  const oldest = getExpertQueue(works, '', 'oldest', 'pending');
  assert.equal(oldest[0].student.id, 'petya-vasechkin');
  assert.equal(getExpertQueue(works, '', 'newest', 'pending')[0].student.id, 'lena-ivanova');
  assert.equal(getExpertQueue(works, '  петя   васечкин ', 'oldest', 'pending').length, 1);
  assert.equal(getExpertQueue(works, 'lena-ivanova', 'oldest', 'pending').length, 1);
  assert.equal(getExpertQueue(works, '', 'oldest', 'reviewed').length, 0);
  assert.deepEqual(
    works.map((work) => work.id),
    oldest.map((work) => work.id),
  );
});

test('drafts remain per task through navigation and disappear only after successful save or discard', async () => {
  await enterExpertDemo();
  const data = await fetchExpertDemo();
  const store = useExpertStore.getState();
  store.setWorkspace(data);
  store.openWork(data.works[0].id);
  store.updateAnalysis({ advice: 'Правка первого задания' });
  store.selectTask(data.works[0].tasks[1].id);
  store.updateAnalysis({ advice: 'Правка второго задания' });
  store.setView('queue');
  store.openWork(data.works[1].id);
  const drafts = useExpertStore.getState().drafts;
  assert.equal(Object.keys(drafts).length, 2);
  assert.equal(data.works[0].tasks[0].analysis.advice, EXPERT_MOCK_TASKS[0].analysis.advice);
  const saved = await saveExpertDemoTask(
    data.works[0].id,
    drafts[data.works[0].tasks[0].id],
    false,
  );
  store.acceptWork(saved, [saved.tasks[0].id]);
  assert.equal(Object.keys(useExpertStore.getState().drafts).length, 1);
  store.openWork(data.works[0].id);
  store.selectTask(data.works[0].tasks[1].id);
  store.discardChanges();
  assert.equal(Object.keys(useExpertStore.getState().drafts).length, 0);
});

test('invalid grades, non-finite geometry, excluded selected points and dangling findings cannot save', async () => {
  await enterExpertDemo();
  const { works } = await fetchExpertDemo();
  const work = works[0];
  for (const score of [-1, 3, 0.5, NaN]) {
    const task = structuredClone(work.tasks[0]);
    task.analysis.score = score;
    await assert.rejects(saveExpertDemoTask(work.id, task, false), { status: 422 });
  }
  const task = structuredClone(work.tasks[0]);
  const numberLine = task.blocks.find((block) => block.kind === 'number_line');
  numberLine.axis.min = numberLine.axis.max;
  assert.notEqual(validateExpertTask(task), null);
  numberLine.axis.min = -14;
  numberLine.axis.selectedPoints = ['nine'];
  assert.notEqual(validateExpertTask(task), null);
  numberLine.axis.selectedPoints = ['three'];
  task.analysis.findings[0].blockId = 'missing';
  assert.notEqual(validateExpertTask(task), null);
  assert.deepEqual((await fetchExpertDemo()).works[0], work);
});

test('storage failures never report a review as saved', async (t) => {
  await enterExpertDemo();
  const { works } = await fetchExpertDemo();
  t.mock.method(localStorage, 'setItem', () => {
    throw new Error('Quota exceeded');
  });
  await assert.rejects(saveExpertDemoTask(works[0].id, works[0].tasks[0], true), { status: 507 });
});

test('causal correction keeps one independent error and explicit grading clears stale grade without changing OCR or analysis', async () => {
  const { gradeExpertDemoTask } = await import('@/lib/api/expert-mock');
  await enterExpertDemo();
  const data = await fetchExpertDemo();
  const store = useExpertStore.getState();
  store.setWorkspace(data);
  store.openWork(data.works[0].id);
  const task = data.works[0].tasks[0];
  const corrected = {
    ...task.blocks.find((block) => block.id === 'lost-point'),
    status: 'correct',
    explanation: 'Исправлено',
  };
  store.updateBlock(corrected);
  const draft = useExpertStore.getState().drafts[task.id];
  assert.equal(draft.blocks.find((block) => block.id === 'back-substitution').status, 'error');
  assert.deepEqual(draft.blocks.find((block) => block.id === 'answer').followsFromBlockIds, [
    'back-substitution',
  ]);
  assert.equal(draft.analysis.gradeStale, true);
  const transferredFinding = draft.analysis.findings.find(
    (finding) => finding.blockId === 'back-substitution',
  );
  assert.equal(transferredFinding.title, EXPERT_FINDING_REVIEW.title);
  assert.ok(transferredFinding.description.endsWith(task.analysis.findings[0].description));
  assert.equal(expertTaskNeedsReview(draft), true);
  await assert.rejects(saveExpertDemoTask(data.works[0].id, draft, true), { status: 422 });
  const graded = await gradeExpertDemoTask(data.works[0].id, draft);
  assert.equal(graded.tasks[0].analysis.score, 1);
  assert.equal(graded.tasks[0].analysis.gradeStale, false);
  assert.deepEqual(graded.tasks[0].blocks, draft.blocks);
  assert.deepEqual(graded.tasks[0].analysis.findings, draft.analysis.findings);
  assert.equal(graded.tasks[0].analysis.advice, draft.analysis.advice);
  await assert.rejects(saveExpertDemoTask(data.works[0].id, graded.tasks[0], true), {
    status: 422,
  });
  const reviewed = structuredClone(graded.tasks[0]);
  reviewed.analysis.findings[0].title = 'Ошибка в обратной подстановке';
  reviewed.analysis.findings[0].description = 'Проверено экспертом';
  assert.equal(expertTaskNeedsReview(reviewed), false);
  await saveExpertDemoTask(data.works[0].id, reviewed, true);
});

test('queue status never labels OCR, rejection or unresolved grading as a finished AI review', async () => {
  const { expertWorkStatus, expertFindingNeedsReview } = await import('@/lib/expert');
  const { EXPERT_WORK_STATUSES } = await import('@/config/expert');
  await enterExpertDemo();
  const work = (await fetchExpertDemo()).works[0];
  const task = work.tasks[0];
  assert.deepEqual(expertWorkStatus(work), EXPERT_WORK_STATUSES.ready);
  task.analysis.hasGrade = false;
  assert.deepEqual(expertWorkStatus(work), EXPERT_WORK_STATUSES.ocr);
  task.analysis.rejectedReason = 'Не видно решения';
  assert.deepEqual(expertWorkStatus(work), EXPERT_WORK_STATUSES.rejected);
  task.gradingJob = { id: 'pending', state: 'unknown' };
  assert.deepEqual(expertWorkStatus(work), EXPERT_WORK_STATUSES.unknown);
  const finding = task.analysis.findings[0];
  const cause = task.blocks.find((block) => block.id === finding.blockId);
  assert.equal(expertFindingNeedsReview(task, finding), false);
  cause.status = 'correct';
  assert.equal(expertFindingNeedsReview(task, finding), true);
  assert.equal(expertFindingNeedsReview(task, { ...finding, kind: 'warning' }), false);
  delete task.analysis.rejectedReason;
  task.analysis.hasGrade = true;
  task.analysis.gradeStale = false;
  task.gradingJob.state = 'stale';
  assert.deepEqual(expertWorkStatus(work), EXPERT_WORK_STATUSES.ready);
});

test('review action follows correction, finding review, explicit grading and approval', async () => {
  const { gradeExpertDemoTask } = await import('@/lib/api/expert-mock');
  await enterExpertDemo();
  const data = await fetchExpertDemo();
  const work = data.works[0];
  const task = work.tasks[0];
  const store = useExpertStore.getState();
  store.setWorkspace(data);
  store.openWork(work.id);
  assert.equal(expertReviewStep(task).action, 'confirm');

  store.updateBlock({
    ...task.blocks.find((block) => block.id === 'lost-point'),
    status: 'correct',
    explanation: 'Распознавание исправлено',
  });
  const transferred = useExpertStore.getState().drafts[task.id];
  assert.equal(expertReviewStep(transferred).action, 'findings');
  store.updateAnalysis({
    findings: transferred.analysis.findings.map((finding) => ({
      ...finding,
      title: 'Ошибка в обратной подстановке',
      description: 'Проверено экспертом',
    })),
  });
  const reviewed = useExpertStore.getState().drafts[task.id];
  assert.equal(expertReviewStep(reviewed).action, 'grade');

  const graded = await gradeExpertDemoTask(work.id, reviewed);
  assert.equal(expertReviewStep(graded.tasks[0]).action, 'confirm');
  const saved = await saveExpertDemoTask(work.id, graded.tasks[0], true);
  assert.equal(expertReviewStep(saved.tasks[0]).action, 'approved');
});

test('unresolved grading never becomes confirmation, while manual grades keep their authority', () => {
  const task = structuredClone(EXPERT_MOCK_TASKS[0]);
  task.analysis.gradeStale = true;
  task.gradingJob = { id: 'job', state: 'pending' };
  assert.equal(expertReviewStep(task).action, 'pending');
  task.gradingJob.state = 'unknown';
  assert.equal(expertReviewStep(task).action, 'refresh');
  task.gradingJob.state = 'failed';
  assert.equal(expertReviewStep(task).action, 'grade');
  task.analysis.gradeStale = false;
  task.gradingJob.state = 'stale';
  assert.equal(expertReviewStep(task).action, 'confirm');
  task.gradingJob.state = 'pending';
  task.manualGradePending = true;
  assert.equal(expertReviewStep(task).action, 'confirm');
});

test('completed refusal shows its reason and confirmation without claiming a grade or no errors', () => {
  globalThis.document.compatMode = 'CSS1Compat';
  const load = moduleLoader();
  const { expertWorkFromDto } = load('@/lib/expert-adapter');
  const { ExpertVerdict } = load('@/components/expert/ExpertVerdict');
  const { ExpertSolution } = load('@/components/expert/ExpertSolution');
  const { useExpertReviewAction } = load('@/hooks/use-expert-review-action');
  const { EXPERT_COPY } = load('@/config/expert');
  const { EXPERT_UI_COPY } = load('@/config/expert-ui');
  const { EXPERT_REVIEW_COPY } = load('@/config/expert-review');
  const { EXPERT_SOLUTION_COPY } = load('@/config/expert-solution-layout');
  const dto = gradingWorkDto('succeeded');
  dto.review = {
    ...dto.review,
    schema_version: 'expert-review.v2',
    phase: 'rejected',
    ocr: null,
    analysis: null,
    grading: null,
    rejection_reason: 'Решение относится к другой задаче',
  };
  dto.images = [{ id: 'source', fileName: 'solution.jpg', previewUrl: '/api/solution/source' }];
  const task = expertWorkFromDto(dto).tasks[0];
  let confirmed = 0;
  const workspace = { busy: false, dirty: false, approveTask: () => confirmed++ };
  const ui = { setDialog: () => undefined };
  const verdict = renderToStaticMarkup(createElement(ExpertVerdict, { task, workspace, ui }));
  const solution = renderToStaticMarkup(
    createElement(ExpertSolution, {
      task,
      selectedBlockId: null,
      sourceAction: createElement('button', null, EXPERT_UI_COPY.sourceOriginal),
    }),
  );

  assert.ok(verdict.includes(dto.review.rejection_reason));
  assert.ok(verdict.includes(EXPERT_UI_COPY.rejected));
  assert.ok(verdict.includes(EXPERT_UI_COPY.rejectedFindings));
  assert.ok(verdict.includes(EXPERT_UI_COPY.confirmRejection));
  assert.ok(verdict.includes(EXPERT_REVIEW_COPY.rejectHint));
  assert.ok(!verdict.includes(EXPERT_UI_COPY.noFindings));
  assert.ok(!verdict.includes(EXPERT_COPY.confirmationHint));
  assert.ok(!verdict.includes(EXPERT_COPY.outOf(task.analysis.maxScore)));
  assert.ok(solution.includes(EXPERT_SOLUTION_COPY.emptyRejected));
  assert.ok(solution.includes(EXPERT_UI_COPY.sourceOriginal));
  assert.ok(!solution.includes(EXPERT_SOLUTION_COPY.empty));
  assert.equal(task.sourceImage, dto.images[0].previewUrl);
  const action = useExpertReviewAction(task, workspace, ui);
  assert.equal(action.disabled, false);
  action.onClick();
  assert.equal(confirmed, 1);
});

test('ungraded empty findings stay neutral and graded results retain their no-errors state', () => {
  const load = moduleLoader();
  const { gridReviewPresentation } = load('@/lib/grid-view');
  const { EXPERT_UI_COPY } = load('@/config/expert-ui');
  const task = structuredClone(EXPERT_MOCK_TASKS[0]);
  task.analysis.hasGrade = false;
  task.analysis.findings = [];

  assert.equal(gridReviewPresentation(task).emptyFindings, EXPERT_UI_COPY.ungradedFindings);
  assert.equal(expertReviewStep(task).action, 'grade');
  task.analysis.hasGrade = true;
  assert.equal(gridReviewPresentation(task).emptyFindings, EXPERT_UI_COPY.noFindings);
  assert.equal(expertReviewStep(task).action, 'confirm');
});

function gradingWorkDto(state = 'pending') {
  const document = {
    schema_version: 'expert-review.v1',
    origin: 'expert',
    phase: 'graded',
    solution_image_ids: [],
    ocr: { blocks: [{ id: 'step', content: { type: 'text', text: 'Исходный шаг' }, sources: [] }] },
    analysis: {
      block_reviews: [
        { block_id: 'step', status: 'correct', explanation: null, follows_from_block_ids: [] },
      ],
      findings: [],
      summary: 'Разбор готов',
      checks: null,
      student_answer: null,
      strengths: [],
    },
    grading: {
      score: state === 'pending' ? 1 : 2,
      criterion: 'Критерий',
      explanation: 'Оценка ИИ',
    },
    rejection_reason: null,
  };
  return {
    id: 'grading-work',
    submissionId: 'submission',
    student: { id: 'student', firstName: 'Петя', lastName: 'Васечкин', email: null, contact: null },
    taskNumber: 13,
    maxScore: 2,
    isDemo: false,
    status: 'draft',
    revision: state === 'pending' ? 5 : 6,
    createdAt: '2026-10-13T10:00:00Z',
    updatedAt: '2026-10-13T10:00:00Z',
    task: { statement: 'Задача', content: null, referenceAnswer: null, referenceSolution: null },
    images: [],
    aiResult: structuredClone(document),
    review: document,
    sentAt: null,
    gradingStale: state === 'pending',
    gradeJob: {
      id: 'own-job',
      state,
      baseRevision: 4,
      preparedRevision: 5,
      appliedRevision: state === 'pending' ? null : 6,
    },
  };
}

test('polling grading success rebases local OCR and analysis edits before saving the new revision', async (t) => {
  t.mock.restoreAll();
  const { expertWorkFromDto } = await import('@/lib/expert-adapter');
  const { saveExpertTask } = await import('@/lib/api/expert');
  const pending = expertWorkFromDto(gradingWorkDto());
  const succeededDto = gradingWorkDto('succeeded');
  const succeeded = expertWorkFromDto(succeededDto);
  const store = useExpertStore.getState();
  store.setWorkspace({ students: [pending.student], works: [pending] });
  store.openWork(pending.id);
  store.updateBlock({
    ...pending.tasks[0].blocks[0],
    text: 'Локальный OCR',
    explanation: 'Локальный разбор',
  });
  store.updateAnalysis({ advice: 'Локальный совет' });
  store.acceptWork(succeeded, []);
  const draft = useExpertStore.getState().drafts[pending.tasks[0].id];
  assert.equal(draft.revision, 6);
  assert.deepEqual(draft.backend, succeeded.tasks[0].backend);
  assert.equal(draft.blocks[0].text, 'Локальный OCR');
  assert.equal(draft.blocks[0].explanation, 'Локальный разбор');
  assert.equal(draft.analysis.advice, 'Локальный совет');
  assert.equal(draft.analysis.score, 2);
  assert.equal(draft.analysis.gradeStale, true);
  assert.equal(pending.tasks[0].revision, 5);
  let command;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    command = { url, body: JSON.parse(init.body) };
    assert.equal(command.body.expectedRevision, succeededDto.revision);
    return Response.json({
      ...succeededDto,
      revision: 7,
      review: command.body.document,
      gradingStale: true,
    });
  });
  const saved = await saveExpertTask({ id: 'expert', mode: 'live' }, pending.id, draft, false);
  assert.equal(saved.tasks[0].revision, 7);
  assert.equal(command.body.document.ocr.blocks[0].content.text, 'Локальный OCR');
  assert.equal(command.body.document.analysis.block_reviews[0].explanation, 'Локальный разбор');
});

test('workspace refresh preserves an explicit local manual grade and sends it against the completed job revision', async (t) => {
  t.mock.restoreAll();
  const { expertWorkFromDto } = await import('@/lib/expert-adapter');
  const { saveExpertTask } = await import('@/lib/api/expert');
  const pending = expertWorkFromDto(gradingWorkDto());
  const succeededDto = gradingWorkDto('succeeded');
  const succeeded = expertWorkFromDto(succeededDto);
  const store = useExpertStore.getState();
  store.setWorkspace({ students: [pending.student], works: [pending] });
  store.openWork(pending.id);
  store.updateAnalysis({ score: 0, verdict: 'Ручная оценка' });
  store.setWorkspace({ students: [pending.student], works: [succeeded] });
  const draft = useExpertStore.getState().drafts[pending.tasks[0].id];
  assert.equal(draft.revision, 6);
  assert.equal(draft.manualGradePending, true);
  assert.equal(draft.analysis.score, 0);
  assert.equal(draft.analysis.verdict, 'Ручная оценка');
  assert.equal(draft.analysis.gradeStale, false);
  let command;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    command = { url, body: JSON.parse(init.body) };
    assert.equal(command.body.expectedRevision, succeededDto.revision);
    return Response.json({ ...succeededDto, revision: 7, review: command.body.document });
  });
  await saveExpertTask({ id: 'expert', mode: 'live' }, pending.id, draft, false);
  assert.ok(command.url.endsWith('/manual-grade'));
  assert.equal(command.body.document.grading.score, 0);
});

test('automatic draft rebasing refuses changed server recognition, analysis, another job or another baseline', async () => {
  const { expertWorkFromDto } = await import('@/lib/expert-adapter');
  const { rebaseExpertDrafts } = await import('@/lib/expert-drafts');
  const pending = expertWorkFromDto(gradingWorkDto());
  const draft = structuredClone(pending.tasks[0]);
  draft.blocks[0].text = 'Локальная правка';
  for (const change of [
    (dto) => {
      dto.review.ocr.blocks[0].content.text = 'Чужой OCR';
    },
    (dto) => {
      dto.review.analysis.summary = 'Чужой разбор';
    },
    (dto) => {
      dto.gradeJob.id = 'other-job';
    },
    (dto) => {
      dto.status = 'sent';
    },
  ]) {
    const incomingDto = gradingWorkDto('succeeded');
    change(incomingDto);
    const drafts = rebaseExpertDrafts(
      { [draft.id]: draft },
      [pending],
      [expertWorkFromDto(incomingDto)],
    );
    assert.equal(drafts[draft.id], draft);
    assert.equal(drafts[draft.id].revision, 5);
  }
  const staleDraft = { ...draft, revision: 4 };
  const drafts = rebaseExpertDrafts(
    { [draft.id]: staleDraft },
    [pending],
    [expertWorkFromDto(gradingWorkDto('succeeded'))],
  );
  assert.equal(drafts[draft.id], staleDraft);
});

test('queued grade-only work is waiting, blocks confirmation and keeps manual override', () => {
  const task = structuredClone(EXPERT_MOCK_TASKS[0]);
  task.gradingJob = { id: 'job', state: 'queued' };
  assert.equal(expertReviewStep(task).action, 'queued');
  assert.equal(expertReviewStep(task).hint, EXPERT_COPY.gradeQueued);
  task.manualGradePending = true;
  assert.notEqual(expertReviewStep(task).action, 'queued');
});
