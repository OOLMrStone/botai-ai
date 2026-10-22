import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deferred,
  hookHarness,
  memoryStore,
  moduleLoader,
  settle,
} from './helpers/hook-harness.mjs';

async function reviewHarness() {
  const harness = hookHarness();
  const calls = [];
  const session = { id: 'expert', mode: 'demo', name: 'Эксперт', email: '', initials: 'Э' };
  let workspace;
  const api = {
    fetchExpertSession: async () => session,
    fetchExpertWorkspace: async () => structuredClone(workspace),
    expertErrorMessage: (error) => error.message,
    ExpertPartialSaveError: class extends Error {},
    saveExpertTask: async (_, workId, task, approve) => {
      calls.push({ kind: 'confirm', workId, task: structuredClone(task), approve });
      const work = workspace.works.find((current) => current.id === workId);
      const saved = {
        ...structuredClone(task),
        approved: approve,
        readOnly: approve,
        revision: task.revision + 1,
        manualGradePending: false,
      };
      return {
        ...work,
        tasks: work.tasks.map((current) => (current.id === task.id ? saved : current)),
      };
    },
    gradeExpertTask: async (_, workId, task) => {
      calls.push({ kind: 'grade', workId, task: structuredClone(task) });
      const work = workspace.works.find((current) => current.id === workId);
      const saved = {
        ...structuredClone(task),
        revision: task.revision + 1,
        gradingJob: { id: 'grading', state: 'pending' },
      };
      return {
        ...work,
        tasks: work.tasks.map((current) => (current.id === task.id ? saved : current)),
      };
    },
  };
  const load = moduleLoader(
    {
      react: harness.react,
      zustand: {
        create: (initializer) => {
          const store = memoryStore()(initializer);
          const hook = (selector = (state) => state) => store(selector);
          hook.getState = store.getState;
          return hook;
        },
      },
      '@/lib/api/expert': api,
      '@/hooks/use-expert-grade-poll': { useExpertGradePoll: () => {} },
    },
    {
      window: { addEventListener() {}, removeEventListener() {} },
    },
  );
  const { EXPERT_MOCK_TASKS } = load('@/config/expert-mock');
  workspace = {
    students: [],
    works: [
      {
        id: 'work',
        studentId: 'student',
        student: { id: 'student', name: 'Ученик', initials: 'У', email: '', contact: '' },
        subject: 'Математика',
        submittedAt: '',
        submittedAgoMinutes: 1,
        status: 'pending',
        tasks: structuredClone(EXPERT_MOCK_TASKS),
      },
    ],
  };
  const { useExpertWorkspace } = load('@/hooks/use-expert-workspace');
  const { useExpertStore } = load('@/stores/expert-store');
  const render = () => harness.render(useExpertWorkspace);
  render();
  await settle();
  useExpertStore.getState().openWork('work');

  return { load, render, api, calls, workspace, store: useExpertStore.getState, harness };
}

test('drafts stay local across task tabs and reset restores only the selected saved review', async () => {
  const flow = await reviewHarness();
  const [first, second] = flow.workspace.works[0].tasks;
  flow.render().updateBlock({ ...first.blocks[0], explanation: 'Правка первого ученика' });
  flow.render().selectTask(second.id);
  flow.render().updateAnalysis({ score: 0, verdict: 'Новая оценка' });
  const secondDraft = structuredClone(flow.render().selectedTask);
  flow.render().selectTask(first.id);

  assert.equal(flow.render().selectedTask.blocks[0].explanation, 'Правка первого ученика');
  assert.equal(flow.calls.length, 0);
  flow.store().setFeedback('Предыдущее действие');
  flow.render().discardChanges();
  assert.deepEqual(flow.render().selectedTask, first);
  assert.equal(flow.render().dirty, false);
  assert.equal(flow.store().feedback, null);
  assert.deepEqual(flow.store().drafts[second.id], secondDraft);
  flow.render().selectTask(second.id);
  assert.deepEqual(flow.render().selectedTask, secondDraft);
});

test('confirmation submits the current local draft once and retains other task drafts', async () => {
  const flow = await reviewHarness();
  const [first, second] = flow.workspace.works[0].tasks;
  flow.render().updateAnalysis({ score: 2, verdict: 'Эксперт подтвердил решение' });
  flow.render().selectTask(second.id);
  flow.render().updateAnalysis({ advice: 'Проверь вычисления' });
  const secondDraft = structuredClone(flow.render().selectedTask);
  flow.render().selectTask(first.id);
  const currentDraft = structuredClone(flow.render().selectedTask);

  assert.equal(await flow.render().approveTask(), true);
  assert.equal(flow.calls.length, 1);
  assert.equal(flow.calls[0].approve, true);
  assert.deepEqual(flow.calls[0].task, currentDraft);
  assert.equal(flow.render().selectedTask.approved, true);
  assert.equal(flow.render().selectedTask.revision, first.revision + 1);
  assert.equal(flow.render().dirty, false);
  assert.deepEqual(flow.store().drafts[second.id], secondDraft);
  assert.equal(flow.render().selectedTask.id, first.id);
  assert.equal(
    flow.load('@/lib/expert-review').expertReviewStep(flow.render().selectedTask).action,
    'approved',
  );
});

test('a revision conflict keeps the draft and never reports confirmation', async () => {
  const flow = await reviewHarness();
  const { ApiError } = flow.load('@/lib/api/client');
  flow.render().updateAnalysis({ score: 0, verdict: 'Ручная оценка' });
  const draft = structuredClone(flow.render().selectedTask);
  flow.api.saveExpertTask = async () => {
    throw new ApiError(409, 'Конфликт ревизий');
  };

  assert.equal(await flow.render().approveTask(), false);
  assert.deepEqual(flow.render().selectedTask, draft);
  assert.equal(flow.render().selectedTask.approved, false);
  assert.equal(flow.render().dirty, true);
  assert.equal(flow.render().error, 'Конфликт ревизий');
  assert.equal(flow.render().busy, false);
});

test('regrading sends current recognition and reset uses the last accepted pending server review', async () => {
  const flow = await reviewHarness();
  const [first, second] = flow.workspace.works[0].tasks;
  flow.render().selectTask(second.id);
  flow.render().updateBlock({ ...second.blocks[0], explanation: 'Уточнённое распознавание' });
  const submitted = structuredClone(flow.render().selectedTask);

  assert.equal(await flow.render().gradeTask(), true);
  assert.deepEqual(flow.calls[0].task, submitted);
  const saved = structuredClone(flow.render().selectedTask);
  assert.equal(saved.gradingJob.state, 'pending');
  assert.equal(flow.render().feedback, flow.load('@/config/expert').EXPERT_COPY.gradePending);
  assert.equal(flow.render().dirty, false);
  flow.render().updateBlock({ ...saved.blocks[0], explanation: 'Следующая локальная правка' });
  flow.render().selectTask(first.id);
  flow.render().selectTask(second.id);
  flow.render().discardChanges();

  assert.deepEqual(flow.render().selectedTask, saved);
  assert.equal(flow.render().selectedTask.revision, submitted.revision + 1);
  assert.equal(
    flow.load('@/lib/expert-review').expertReviewStep(flow.render().selectedTask).action,
    'pending',
  );
  assert.equal(flow.calls.length, 1);
});

test('double confirmation and edits during a pending request cannot replace the submitted draft', async () => {
  const flow = await reviewHarness();
  const reply = deferred();
  flow.render().updateAnalysis({ score: 2, verdict: 'Верно' });
  const submitted = structuredClone(flow.render().selectedTask);
  let requests = 0;
  flow.api.saveExpertTask = async () => {
    requests++;
    return reply.promise;
  };

  const first = flow.render().approveTask();
  assert.equal(await flow.render().approveTask(), false);
  assert.equal(flow.render().updateAnalysis({ score: 0 }), false);
  assert.deepEqual(flow.render().selectedTask, submitted);
  const work = flow.workspace.works[0];
  reply.resolve({
    ...work,
    tasks: work.tasks.map((task) =>
      task.id === submitted.id
        ? { ...submitted, approved: true, revision: submitted.revision + 1 }
        : task,
    ),
  });
  assert.equal(await first, true);
  assert.equal(requests, 1);
  assert.equal(flow.render().selectedTask.approved, true);
});
