import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { moduleLoader, hookHarness, deferred } from './helpers/hook-harness.mjs';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
function loader(mocks = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = resolve(root, 'src', name.slice(2));
    const file = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    const source = readFileSync(file, 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const loadedModule = { exports: {} };
    cache.set(name, loadedModule);
    compileFunction(result.outputText, ['require', 'module', 'exports'], { filename: file })(
      load,
      loadedModule,
      loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return load;
}

const load = loader();

function attemptDeletionSetup() {
  const harness = hookHarness();
  const requests = [],
    forgotten = [],
    resetItems = [];
  let owner = 'owner',
    invalidations = 0;
  let remove = async () => {};
  const attempt = { id: 'attempt', items: [{ id: 'item' }] };
  const loadDelete = moduleLoader({
    react: harness.react,
    '@/lib/api/learning': {
      deleteAttempt: async (id) => {
        requests.push(id);
        return remove();
      },
    },
    '@/lib/attempt-drafts': { forgetAttemptDraft: (id) => forgotten.push(id) },
    '@/lib/learning-resources': { invalidateAttempts: () => invalidations++ },
    '@/stores/auth-store': { useAuthStore: { getState: () => ({ user: { id: owner } }) } },
    '@/stores/tasks-store': {
      useTasksStore: { getState: () => ({ resetTaskProgress: (ids) => resetItems.push(ids) }) },
    },
  });
  return {
    render: () =>
      harness.render(() => loadDelete('@/hooks/use-attempt-delete').useAttemptDelete(attempt)),
    requests,
    forgotten,
    resetItems,
    invalidations: () => invalidations,
    setRemove: (fn) => {
      remove = fn;
    },
    changeOwner: (id) => {
      owner = id;
    },
  };
}

test('attempt deletion requires confirmation, blocks double submit and refreshes all attempt lists', async () => {
  const s = attemptDeletionSetup();
  await s.render().remove();
  assert.deepEqual(s.requests, []);
  s.render().changeOpen(true);
  s.render().changeOpen(false);
  assert.deepEqual(s.requests, []);
  s.render().changeOpen(true);
  const response = deferred();
  s.setRemove(() => response.promise);
  const view = s.render();
  const deleting = view.remove();
  await view.remove();
  s.render().changeOpen(false);
  assert.equal(s.render().open, true);
  assert.equal(s.render().deleting, true);
  assert.deepEqual(s.requests, ['attempt']);
  response.resolve();
  await deleting;
  assert.equal(s.render().open, false);
  assert.equal(s.render().deleting, false);
  assert.equal(s.invalidations(), 1);
  assert.deepEqual(s.forgotten, ['attempt']);
  assert.deepEqual(s.resetItems, [['item']]);
});

test('failed deletion preserves the card and draft and permits an idempotent retry', async () => {
  const s = attemptDeletionSetup();
  s.render().changeOpen(true);
  s.setRemove(async () => {
    throw new Error('offline');
  });
  await s.render().remove();
  assert.equal(s.render().open, true);
  assert.equal(s.render().deleting, false);
  assert.equal(s.render().error, 'offline');
  assert.deepEqual(s.forgotten, []);
  assert.equal(s.invalidations(), 0);
  s.setRemove(async () => {});
  await s.render().remove();
  assert.deepEqual(s.requests, ['attempt', 'attempt']);
  assert.equal(s.render().error, null);
  assert.equal(s.invalidations(), 1);
});

test('late deletion response cannot erase another account draft or invalidate its cache', async () => {
  const s = attemptDeletionSetup();
  s.render().changeOpen(true);
  const response = deferred();
  s.setRemove(() => response.promise);
  const deleting = s.render().remove();
  s.changeOwner('another');
  response.resolve();
  await deleting;
  assert.equal(s.invalidations(), 0);
  assert.deepEqual(s.forgotten, []);
  assert.deepEqual(s.resetItems, []);
});

function serverExamsSetup(exams, createExamAttempt) {
  const harness = hookHarness();
  const routes = [];
  const loadServerExams = moduleLoader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push: (path) => routes.push(path) }) },
    '@/hooks/use-async-data': { useAsyncData: () => ({ data: exams, failed: false, retry() {} }) },
    '@/lib/learning-resources': { examsResource: {}, invalidateAttempts() {} },
    '@/lib/api/learning': { createExamAttempt },
  });
  const render = () =>
    harness.render(() => loadServerExams('@/hooks/use-server-exams').useServerExams());
  return { render, routes, harness };
}

const serverExam = (id, properties = {}) => ({
  id,
  title: `Пробник ${id}`,
  createdAt: '2026-10-01T12:00:00Z',
  totalTasks: 20,
  maxPoints: 33,
  ...properties,
});

test('server exam double click creates one attempt and keeps pending through navigation', async () => {
  const response = deferred();
  const calls = [];
  const s = serverExamsSetup([serverExam('exam')], (...args) => {
    calls.push(args);
    return response.promise;
  });
  const api = s.render();
  const first = api.openExam('exam');
  await api.openExam('exam');
  assert.equal(calls.length, 1);
  assert.equal(s.render().pending, true);
  response.resolve({ id: 'created' });
  await first;
  assert.equal(s.routes.length, 1);
  assert.equal(s.render().pending, true);
});

test('server exam retries reuse the creation key after an ambiguous network failure', async () => {
  const keys = [];
  const s = serverExamsSetup([serverExam('exam')], async (_id, key) => {
    keys.push(key);
    if (keys.length === 1) throw new Error('offline');
    return { id: 'created' };
  });
  await s.render().openExam('exam', true);
  assert.equal(s.render().pending, false);
  assert.equal(s.render().error, 'offline');
  await s.render().openExam('exam', true);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(s.routes.length, 1);
  assert.equal(s.render().error, null);
});

test('active exam wins over an older completed attempt and is filtered as unfinished', async () => {
  const exam = serverExam('exam', {
    activeAttemptId: 'active',
    latestAttempt: {
      id: 'completed',
      status: 'completed',
      completedAt: '2026-10-01T12:00:00Z',
      summary: { earnedPoints: 0 },
    },
  });
  let created = 0;
  const s = serverExamsSetup([exam], async () => {
    created++;
    return { id: 'new' };
  });
  const api = s.render();
  assert.equal(api.results.exam, undefined);
  assert.ok(api.sessions.exam);
  const { filterMockExams } = load('@/lib/mock-exams');
  assert.equal(filterMockExams(api.exams, 'unsolved', api.results).length, 1);
  assert.equal(filterMockExams(api.exams, 'solved', api.results).length, 0);
  await api.openExam('exam');
  assert.deepEqual(s.routes, [load('@/config/integration').LEARNING_ROUTES.attempt('active')]);
  assert.equal(created, 0);
});

test('leaving the catalog before creation finishes does not hijack later navigation', async () => {
  const response = deferred();
  const s = serverExamsSetup([serverExam('exam')], () => response.promise);
  const opening = s.render().openExam('exam');
  s.harness.unmount();
  response.resolve({ id: 'created' });
  await opening;
  assert.deepEqual(s.routes, []);
});

test('fresh exam attempt does not overwrite or resume the active attempt', async () => {
  const calls = [];
  const exam = serverExam('exam', { activeAttemptId: 'active' });
  const s = serverExamsSetup([exam], async (...args) => {
    calls.push(args);
    return { id: 'fresh' };
  });
  await s.render().openExam('exam', true);
  assert.equal(calls.length, 1);
  assert.deepEqual(s.routes, [load('@/config/integration').LEARNING_ROUTES.attempt('fresh')]);
  assert.equal(exam.activeAttemptId, 'active');
});

test('exam sort preserves source order and recognizes a completed zero-point result', () => {
  const { sortMockExams } = load('@/lib/mock-exams');
  const exams = [
    { id: 'old', date: '2026-10-01' },
    { id: 'new', date: '2026-10-03' },
    { id: 'middle', date: '2026-10-02' },
  ];
  const results = { old: { score: 0, completedAt: '2026-10-04' } };
  const ids = (sort) => sortMockExams(exams, sort, results).map((exam) => exam.id);
  assert.deepEqual(ids('newest'), ['new', 'middle', 'old']);
  assert.deepEqual(ids('oldest'), ['old', 'middle', 'new']);
  assert.deepEqual(ids('score'), ['old', 'new', 'middle']);
  assert.deepEqual(
    exams.map((exam) => exam.id),
    ['old', 'new', 'middle'],
  );
});

function renderExamCatalog(state = {}) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const loadCatalog = moduleLoader({
    '@/hooks/use-server-exams': {
      useServerExams: () => ({
        data: [],
        exams: [],
        loading: false,
        failed: false,
        sort: 'newest',
        filter: 'all',
        sessions: {},
        results: {},
        setSort() {},
        setFilter() {},
        ...state,
      }),
    },
    '@/hooks/use-mock-exam-sort-menu': {
      useMockExamSortMenu: () => ({
        open: false,
        rootRef: { current: null },
        triggerRef: { current: null },
      }),
    },
    '@/components/mock-exams/MockExamCard': {
      MockExamCard: ({ exam }) => React.createElement('button', null, exam.title),
    },
    '@/components/mock-exams/MockExamDetails': { MockExamDetails: () => null },
  });
  return renderToStaticMarkup(
    React.createElement(loadCatalog('@/components/mock-exams/MockExamCatalog').MockExamCatalog),
  );
}

test('exam filtering renders no actions for hidden variants', () => {
  const exams = [
    { id: 'solved', title: 'Решённый пробник', date: '2026-10-02', tasks: [] },
    { id: 'hidden', title: 'Скрытый пробник', date: '2026-10-01', tasks: [] },
  ];
  const markup = renderExamCatalog({
    data: exams,
    exams,
    filter: 'solved',
    results: { solved: { score: 0, completedAt: '2026-10-02' } },
  });
  assert.ok(markup.includes('Решённый пробник'));
  assert.ok(!markup.includes('Скрытый пробник'));
});

test('exam catalog distinguishes loading and failure from a successful empty response', () => {
  const { LEARNING_COPY } = load('@/config/integration');
  const { MOCK_EXAM_COPY } = load('@/config/mock-exams');
  for (const data of [null, []]) {
    const loading = renderExamCatalog({ data, loading: true });
    assert.ok(loading.includes(LEARNING_COPY.loading));
    assert.ok(!loading.includes(MOCK_EXAM_COPY.emptyFilter));
    assert.ok(!loading.includes(LEARNING_COPY.loadError));

    const failure = renderExamCatalog({ data, failed: true });
    assert.ok(failure.includes(LEARNING_COPY.loadError));
    assert.ok(!failure.includes(MOCK_EXAM_COPY.emptyFilter));
    assert.ok(!failure.includes(LEARNING_COPY.loading));
  }
  const empty = renderExamCatalog();
  assert.ok(empty.includes(MOCK_EXAM_COPY.emptyFilter));
  assert.ok(!empty.includes(LEARNING_COPY.loading));
  assert.ok(!empty.includes(LEARNING_COPY.loadError));
});

test('async data reports loading before the first fetch effect and ends it on response or failure', () => {
  let snapshot = { data: null, error: null, loading: false };
  const resource = { snapshot: () => snapshot, subscribe() {}, invalidate() {} };
  const loadAsyncData = moduleLoader({
    react: {
      useEffect() {},
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
  });
  const { useAsyncData } = loadAsyncData('@/hooks/use-async-data');
  assert.equal(useAsyncData(resource).loading, true);
  snapshot = { data: [], error: null, loading: false };
  assert.equal(useAsyncData(resource).loading, false);
  assert.equal(useAsyncData(resource).failed, false);
  snapshot = { data: null, error: new Error('offline'), loading: false };
  assert.equal(useAsyncData(resource).loading, false);
  assert.equal(useAsyncData(resource).failed, true);
});

const validation = load('@/lib/validation');
for (const answer of ['0', '-12', '12,5', '12.5', '000.50', '-0']) {
  test(`готовый ответ: ${answer}`, () => assert.equal(validation.isValidShortAnswer(answer), true));
}
for (const answer of [
  '',
  '-',
  '12,',
  'SELECT * FROM',
  '1/2',
  '1e2',
  '0x10',
  'Infinity',
  '1.2.3',
  '1 2',
  '.5',
  '+1',
]) {
  test(`не готовый ответ: ${JSON.stringify(answer)}`, () =>
    assert.equal(validation.isValidShortAnswer(answer), false));
}
for (const answer of ['', '-', '12,', '12.', '-0,']) {
  test(`черновик: ${JSON.stringify(answer)}`, () =>
    assert.equal(validation.isShortAnswerDraft(answer), true));
}

test('единая проверка не принимает экспоненту и hex из старой сессии', () => {
  const { isTrainingAnswerCorrect } = load('@/lib/task-training');
  assert.equal(isTrainingAnswerCorrect({ acceptedAnswers: ['100'] }, '1e2'), false);
  assert.equal(isTrainingAnswerCorrect({ acceptedAnswers: ['16'] }, '0x10'), false);
});
test('десятичные записи сравниваются без потери точности', () => {
  const { isTrainingAnswerCorrect } = load('@/lib/task-training');
  assert.equal(isTrainingAnswerCorrect({ acceptedAnswers: ['12.5'] }, '0012,500'), true);
  assert.equal(
    isTrainingAnswerCorrect({ acceptedAnswers: ['9007199254740992'] }, '9007199254740993'),
    false,
  );
});

function reactHarness() {
  const slots = [];
  let cursor = 0;
  return {
    render(hook) {
      cursor = 0;
      return hook();
    },
    react: {
      useRef(value) {
        const index = cursor++;
        return (slots[index] ??= { current: value });
      },
      useState(value) {
        const index = cursor++;
        slots[index] ??= value;
        return [
          slots[index],
          (next) => {
            slots[index] = next;
          },
        ];
      },
      useEffect() {},
      useTransition() {
        return [false, (run) => run()];
      },
    },
  };
}

test('вставка SQL отклоняется целиком, удаление и минус разрешены', () => {
  const harness = reactHarness();
  const { useAnswerInput } = loader({ react: harness.react })('@/hooks/use-answer-input');
  const accepted = [];
  const input = harness.render(() =>
    useAnswerInput({
      answerKey: 'task-1',
      value: '12',
      disabled: false,
      readOnly: false,
      onValueChange: (value) => accepted.push(value),
    }),
  );
  input.change('12abc34');
  input.change('SELECT * FROM');
  input.change('');
  input.change('-');
  input.change('-12,5');
  assert.deepEqual(accepted, ['', '-', '-12,5']);
});

test('первый клик открывает маршрут, повторный не запускает второй переход', () => {
  const harness = reactHarness();
  const paths = [];
  const { useMockExamNavigation } = loader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push: (path) => paths.push(path), prefetch() {} }) },
  })('@/hooks/use-mock-exam-navigation');
  const navigation = harness.render(() => useMockExamNavigation([]));
  navigation.openExam('variant-04');
  navigation.openExam('variant-04');
  assert.deepEqual(paths, ['/mock-training/variant-04']);
});

test('вход начинает с первого задания и сохраняет ответы, вложения и результат', () => {
  const { useMockExamsStore } = loader({ 'zustand/middleware': { persist: (create) => create } })(
    '@/stores/mock-exams-store',
  );
  useMockExamsStore.getState().start('exam');
  useMockExamsStore.getState().setAnswer('exam', 'task', '12');
  useMockExamsStore.getState().addAttachments('exam', 'task', ['solution.jpg']);
  useMockExamsStore.getState().setCurrentIndex('exam', 5);
  useMockExamsStore.getState().start('exam');
  const session = useMockExamsStore.getState().sessions.exam;
  assert.equal(session.currentIndex, 0);
  assert.equal(session.answers.task, '12');
  assert.deepEqual(session.attachments.task, ['solution.jpg']);
});

test('ошибка вставки остаётся у своего задания, DOM ref сохраняется при смене пустого ответа', () => {
  const harness = reactHarness();
  const { useAnswerInput } = loader({ react: harness.react })('@/hooks/use-answer-input');
  const render = (answerKey) =>
    harness.render(() =>
      useAnswerInput({
        answerKey,
        value: '',
        disabled: false,
        readOnly: false,
        onValueChange() {},
      }),
    );
  const first = render('task-1');
  first.change('SELECT * FROM');
  assert.equal(typeof render('task-1').error, 'string');
  const next = render('task-2');
  assert.equal(next.error, undefined);
  assert.equal(next.inputRef, first.inputRef);
});

test('минус остаётся черновиком, ошибка blur исчезает после завершения числа', () => {
  const harness = reactHarness();
  const { useAnswerInput } = loader({ react: harness.react })('@/hooks/use-answer-input');
  let value = '-';
  const render = () =>
    harness.render(() =>
      useAnswerInput({
        answerKey: 'task-1',
        value,
        disabled: false,
        readOnly: false,
        onValueChange(next) {
          value = next;
        },
      }),
    );
  assert.equal(render().error, undefined);
  render().blur();
  assert.equal(typeof render().error, 'string');
  assert.equal(value, '-');
  render().change('-2,5');
  assert.equal(value, '-2,5');
  assert.equal(render().error, undefined);
});

test('старый неверный ответ показывает ошибку, неизменяемый ответ не меняется', () => {
  const harness = reactHarness();
  const { useAnswerInput } = loader({ react: harness.react })('@/hooks/use-answer-input');
  const changes = [];
  const input = harness.render(() =>
    useAnswerInput({
      answerKey: 'task-1',
      value: '1e2',
      disabled: false,
      readOnly: true,
      onValueChange(next) {
        changes.push(next);
      },
    }),
  );
  assert.equal(typeof input.error, 'string');
  input.change('100');
  assert.deepEqual(changes, []);
});

function setupHarness({ failFirstRequest = false, fixedExamNumber = null } = {}) {
  const paths = [];
  const requests = [];
  const states = [];
  let cursor = 0;
  const store = loader()('@/stores/tasks-store').useTasksStore;
  const useStore = (selector) => selector(store.getState());
  useStore.getState = store.getState;
  useStore.setState = store.setState;
  const catalogResource = {};
  const favoritesResource = {};
  const tasks = Array.from({ length: 7 }, (_, index) => ({
    id: `setup-task-${index}`,
    examNumber: index === 6 ? 2 : 1,
    difficulty: index % 2 ? 3 : 1,
    isGrob: false,
    topicIds: [index % 2 ? 'triangle' : 'circle'],
  }));
  const catalog = {
    format: { id: 'server-format' },
    numbers: [1, 2].map((number) => ({
      examNumber: number,
      part: 1,
      title: String(number),
      availableCount: tasks.filter((task) => task.examNumber === number).length,
      topics: [],
    })),
  };
  const loadSetup = loader({
    'next/navigation': {
      useRouter: () => ({ push: (path) => paths.push(path), replace: (path) => paths.push(path) }),
    },
    react: {
      useEffect: (effect) => effect(),
      useRef: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useState: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (value) => {
            states[index] = typeof value === 'function' ? value(states[index]) : value;
          },
        ];
      },
    },
    '@/hooks/use-async-data': {
      useAsyncData: (resource) => ({
        data: resource === catalogResource ? catalog : [],
        failed: false,
        retry() {},
      }),
    },
    '@/lib/learning-resources': { catalogResource, favoritesResource, invalidateAttempts() {} },
    '@/lib/api/learning': {
      createTraining: async (request, key) => {
        requests.push({ request, key });
        if (failFirstRequest && requests.length === 1) throw new Error('Connection lost');
        return { id: 'saved-server-attempt' };
      },
    },
    '@/stores/tasks-store': { useTasksStore: useStore },
  });
  const render = (hook) => {
    cursor = 0;
    return hook(tasks, fixedExamNumber);
  };
  return { store, paths, loadSetup, tasks, requests, render };
}

test('карточка открывает настройку выбранного номера без создания попытки', () => {
  const { store, paths, requests, loadSetup, render } = setupHarness();
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  catalog.openNumber(1);
  assert.deepEqual(paths, ['/training/setup?examNumber=1']);
  assert.deepEqual(requests, []);
  assert.equal(store.getState().session, null);
  assert.equal(store.getState().setupExamNumber, null);
  assert.deepEqual(store.getState().setupTaskIds, []);
});

test('избранное создаёт сохранённую серверную подборку с каноническими ID', async () => {
  const { store, paths, loadSetup, tasks, requests, render } = setupHarness();
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  await catalog.openFavorites(tasks.slice(0, 5));
  assert.deepEqual(requests[0].request, {
    formatId: 'server-format',
    selections: [],
    source: 'favorites',
    taskIds: tasks.slice(0, 5).map((task) => task.id),
  });
  assert.equal(paths.pop(), '/training?attempt=saved-server-attempt');
  assert.equal(store.getState().session, null);
  assert.ok(requests[0].key);
});

test('повторная настройка сохраняет полный номер, а не только выбранные задачи', () => {
  const { store, tasks } = setupHarness();
  store.getState().openSetup(tasks, 'catalog', 1);
  store.getState().startSession(tasks.slice(0, 2), 'catalog');
  store.getState().requestSetup();
  assert.equal(store.getState().session, null);
  assert.deepEqual(
    store.getState().setupTaskIds,
    tasks.map((task) => task.id),
  );
  assert.equal(store.getState().setupExamNumber, 1);
});

test('старая сессия с другим источником не наследует чужую настройку', () => {
  const { store, tasks } = setupHarness();
  store.getState().openSetup(tasks, 'catalog', 1);
  store.getState().startSession(tasks.slice(0, 2), 'favorites');
  store.getState().requestSetup();
  assert.deepEqual(
    store.getState().setupTaskIds,
    tasks.slice(0, 2).map((task) => task.id),
  );
  assert.equal(store.getState().setupSource, 'favorites');
  assert.equal(store.getState().setupExamNumber, null);
});

test('старт отправляет тему, сложность и количество серверу', async () => {
  const { store, paths, loadSetup, requests, render } = setupHarness({ fixedExamNumber: 1 });
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  setup.update(1, { topicIds: ['circle'], count: 2 });
  setup.setDifficultyLevel(0);
  setup = render(hook);
  await setup.start();
  assert.equal(store.getState().session, null);
  assert.deepEqual(requests[0].request, {
    formatId: 'server-format',
    selections: [{ examNumber: 1, count: 2, topicIds: ['circle'] }],
    difficultyPreference: 0,
    source: 'catalog',
  });
  assert.deepEqual(paths, ['/training?attempt=saved-server-attempt']);
});

test('настройка одного номера сохраняет его при попытке удаления и добавления другого', async () => {
  const { loadSetup, requests, render } = setupHarness({ fixedExamNumber: 1 });
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  assert.equal(setup.canChooseNumbers, false);
  assert.equal(setup.numbersOpen, false);
  assert.deepEqual(setup.selections, [{ examNumber: 1, count: 3 }]);
  setup.toggle(1);
  setup.toggle(2);
  setup = render(hook);
  assert.deepEqual(setup.selections, [{ examNumber: 1, count: 3 }]);
  setup.update(1, { count: 5 });
  setup = render(hook);
  await setup.start();
  assert.deepEqual(requests[0].request.selections, [{ examNumber: 1, count: 5 }]);
});

test('настройка восстанавливает номер из адреса, а общий адрес остаётся свободным сборщиком', () => {
  const { trainingSetupPath } = load('@/config/tasks');
  const tasks = [{ examNumber: 16 }];
  let search = new URLSearchParams(new URL(trainingSetupPath(16), 'https://botai.test').search);
  const { useTrainingSetupRoute } = loader({
    'next/navigation': { useSearchParams: () => search },
  })('@/hooks/use-training-setup-route');
  assert.equal(useTrainingSetupRoute(null), null);
  assert.equal(useTrainingSetupRoute(tasks), 16);
  search = new URLSearchParams();
  assert.equal(useTrainingSetupRoute(tasks), null);
  const { trainingSetupExamNumber } = load('@/lib/training-setup');
  for (const invalid of ['', '0', '-1', '1.5', 'abc', '999']) {
    assert.equal(trainingSetupExamNumber(invalid, tasks), null);
  }
});

test('неизвестный номер в адресе открывает сборщик, где можно выбрать доступные задачи', async () => {
  const { trainingSetupPath } = load('@/config/tasks');
  const search = new URLSearchParams(new URL(trainingSetupPath(999), 'https://botai.test').search);
  const { useTrainingSetupRoute } = loader({
    'next/navigation': { useSearchParams: () => search },
  })('@/hooks/use-training-setup-route');
  const fixedExamNumber = useTrainingSetupRoute([{ examNumber: 1 }]);
  const { loadSetup, requests, render } = setupHarness({ fixedExamNumber });
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  assert.equal(setup.canChooseNumbers, true);
  assert.equal(setup.numbersOpen, true);
  assert.deepEqual(setup.selections, []);
  setup.toggle(1);
  setup = render(hook);
  await setup.start();
  assert.deepEqual(requests[0].request.selections, [{ examNumber: 1, count: 3 }]);
});

test('пустой выбор и нехватка задач не создают ложный успех, несколько номеров независимы', async () => {
  const { loadSetup, requests, render } = setupHarness();
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  await setup.start();
  assert.equal(requests.length, 0);
  setup.toggle(1);
  setup.toggle(2);
  setup = render(hook);
  assert.equal(setup.selections.length, 2);
  assert.equal(setup.total, 4);
  setup.update(2, { count: 20 });
  setup = render(hook);
  assert.equal(setup.shortage, true);
  assert.equal(setup.canStart, false);
  await setup.start();
  assert.equal(requests.length, 0);
});

test('название бренда в заголовках, подписях и акцентах использует полный знак', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { BRAND } = load('@/config/brand');
  const { COPY } = load('@/config/onboarding-steps');
  const { ScreenHeading } = load('@/components/onboarding/ScreenHeading');
  const { HighlightText } = load('@/components/onboarding/HighlightText');
  const cases = [
    createElement(ScreenHeading, { title: COPY.goalResult.title }),
    createElement(ScreenHeading, { title: 'Название', subtitle: BRAND.name }),
    createElement(HighlightText, { text: `*${BRAND.name}*` }),
  ];

  for (const element of cases) {
    const markup = renderToStaticMarkup(element);
    assert.match(markup, /role="img" data-wordmark="inline" aria-label="ботai"/);
    assert.match(markup, /class="wordmark-ai inline-block shrink-0">ai<\/span>/);
    assert.doesNotMatch(markup, /sr-only|retrogression/);
    assert.doesNotMatch(markup, /\bbotai\b/);
  }
});

test('заголовки и логотип используют один спокойный вес независимо от экрана', () => {
  const { layout } = load('@/config/layout');
  for (const variant of Object.values(layout.heading.variants)) {
    assert.match(variant.title, /\bfont-semibold\b/);
    assert.doesNotMatch(variant.title, /\bfont-(?:bold|extrabold|black)\b/);
  }
  assert.match(layout.wordmark.root, /\bfont-semibold\b/);
});

test('desktop-навигация показывает общий знак и сохраняет учебные маршруты', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ROUTES } = load('@/config/onboarding-steps');
  const { APP_TABS } = load('@/config/navigation');
  const loadNavigation = loader({
    'next/navigation': { usePathname: () => ROUTES.tasks },
  });
  const { AppNavigation } = loadNavigation('@/components/app/AppNavigation');
  const markup = renderToStaticMarkup(createElement(AppNavigation));

  assert.match(markup, /data-wordmark="navigation" aria-label="ботai"/);
  assert.match(markup, /aria-current="page"[^>]*href="\/tasks"/);
  for (const tab of APP_TABS) assert.ok(markup.includes(`href="${tab.href}"`), tab.href);
  assert.ok(
    !markup.includes(`href="${ROUTES.quizzes}"`),
    'выключенные квизы отсутствуют в навигации',
  );
  assert.ok(markup.includes(`href="${ROUTES.storefront}"`));
  assert.doesNotMatch(markup, /wordmark-chrome|\bbotai\b/);
});

test('шапка и подвал витрины используют компактный знак той же системы', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const loadStorefront = loader({
    '@/hooks/use-storefront': {
      useStorefrontNavigation: () => ({ menuOpen: false }),
    },
  });

  for (const name of ['StorefrontNavigation', 'StorefrontFooter']) {
    const component = loadStorefront(`@/components/storefront/${name}`)[name];
    const markup = renderToStaticMarkup(createElement(component));
    assert.match(markup, /data-wordmark="compact" aria-label="ботai"/, name);
    assert.match(markup, /class="wordmark-ai inline-block shrink-0">ai<\/span>/, name);
    assert.doesNotMatch(markup, /wordmark-chrome/, name);
  }
});

test('действия витрины сохраняют переход и геометрию общей капсулы', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { StorefrontAction } = load('@/components/storefront/StorefrontAction');
  const { ROUTES } = load('@/config/onboarding-steps');

  for (const tone of ['orange', 'dark']) {
    const markup = renderToStaticMarkup(
      createElement(StorefrontAction, { href: ROUTES.studentEntry, tone }, 'Учиться'),
    );
    assert.ok(markup.includes(`href="${ROUTES.studentEntry}"`));
    assert.match(markup, /data-control-size="default"/);
    assert.match(markup, /\bh-12\b/);
    assert.match(markup, /\brounded-control\b/);
    assert.doesNotMatch(markup, /data-control-size="storefront"/);
  }
});

function studentEntryHarness(refresh) {
  const paths = [];
  const states = [];
  const effects = [];
  const loadEntry = loader({
    react: {
      useState: (initial) => [initial, (value) => states.push(value)],
      useEffect: (effect) => effects.push(effect),
    },
    'next/navigation': { useRouter: () => ({ replace: (path) => paths.push(path) }) },
    '@/stores/auth-store': { useAuthStore: (select) => select({ refresh }) },
  });
  const { useStudentEntry: renderEntry } = loadEntry('@/hooks/use-student-entry');
  const entry = renderEntry();
  const cleanup = effects[0]();

  return { entry, paths, states, cleanup };
}

for (const authenticated of [false, true]) {
  test(`/learn выбирает маршрут после проверки ${authenticated ? 'активной' : 'гостевой'} сессии`, async () => {
    const { STUDENT_ENTRY } = load('@/config/student-entry');
    const { paths, states } = studentEntryHarness(() =>
      Promise.resolve(authenticated ? { id: 'student' } : null),
    );
    assert.deepEqual(paths, []);

    await Promise.resolve();

    assert.deepEqual(paths, [STUDENT_ENTRY[authenticated ? 'authenticated' : 'anonymous']]);
    assert.deepEqual(states, []);
  });
}

test('/learn не считает ошибку проверки гостевой сессией и позволяет повторить', async () => {
  const { entry, paths, states } = studentEntryHarness(() => Promise.reject(new Error('offline')));

  await Promise.resolve();

  assert.deepEqual(paths, []);
  assert.deepEqual(states, [true]);
  entry.retry();
  assert.deepEqual(states, [true, false]);
});

test('/learn не перенаправляет после ухода со страницы', async () => {
  const { cleanup, paths, states } = studentEntryHarness(() => Promise.resolve({ id: 'student' }));
  cleanup();

  await Promise.resolve();

  assert.deepEqual(paths, []);
  assert.deepEqual(states, []);
});

test('подсказка формата помещается в поле, ответ сохраняется и ошибка не переходит к следующему', () => {
  const harness = reactHarness();
  const { useAnswerInput } = loader({ react: harness.react })('@/hooks/use-answer-input');
  const { SHORT_ANSWER_COPY } = load('@/config/short-answer');
  let value = '12';
  const render = (answerKey = 'task-1') =>
    harness.render(() =>
      useAnswerInput({
        answerKey,
        value,
        disabled: false,
        readOnly: false,
        onValueChange(next) {
          value = next;
        },
      }),
    );

  render().change('12abc');
  assert.equal(value, '12');
  assert.equal(render().errorHint, SHORT_ANSWER_COPY.invalidHint);
  assert.equal(render().showInlineHint, true);
  assert.equal(render('task-2').showInlineHint, false);

  render().clear();
  render().change('abc');
  assert.equal(value, '');
  assert.equal(render().errorHint, SHORT_ANSWER_COPY.invalidHint);
  assert.equal(render().showInlineHint, false);

  render().change('-');
  render().blur();
  assert.equal(render().errorHint, SHORT_ANSWER_COPY.incompleteHint);
  assert.equal(render().showInlineHint, true);
  render().change('-2,5');
  assert.equal(render().errorHint, undefined);
});

function keyboardHarness(options, run) {
  const previous = Object.fromEntries(
    ['window', 'document', 'Element'].map((key) => [key, globalThis[key]]),
  );
  const listeners = new Map();
  const selected = [];
  let modal = false;
  class Target {
    constructor(native = false) {
      this.native = native;
    }
    closest() {
      return this.native ? this : null;
    }
  }
  globalThis.Element = Target;
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  globalThis.document = { querySelector: () => (modal ? {} : null) };
  let cleanup;
  const { useTaskKeyboardNavigation: renderKeyboard } = loader({
    react: {
      useRef: (value) => ({ current: value }),
      useEffect: (effect) => {
        cleanup = effect();
      },
    },
  })('@/hooks/use-task-keyboard-navigation');

  try {
    renderKeyboard({
      currentIndex: 1,
      lastIndex: 3,
      enabled: true,
      onSelect: (index) => selected.push(index),
      ...options,
    });
    const press = (key, overrides = {}) => {
      let prevented = false;
      listeners.get('keydown')?.({
        key,
        target: new Target(),
        preventDefault() {
          prevented = true;
        },
        ...overrides,
      });
      return prevented;
    };
    run({
      selected,
      press,
      Target,
      setModal: (open) => {
        modal = open;
      },
      listeners,
    });
  } finally {
    cleanup?.();
    assert.equal(listeners.size, 0);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

test('стрелки переключают по одному заданию и доходят до обзора без выхода за границы', () => {
  keyboardHarness({}, ({ press, selected }) => {
    assert.equal(press('ArrowLeft'), true);
    assert.equal(press('ArrowRight'), true);
    assert.equal(press('ArrowDown'), false);
    assert.deepEqual(selected, [0, 2]);
  });
  keyboardHarness({ currentIndex: 0 }, ({ press, selected }) => {
    assert.equal(press('ArrowLeft'), false);
    assert.deepEqual(selected, []);
  });
  keyboardHarness({ currentIndex: 2 }, ({ press, selected }) => {
    press('ArrowRight');
    assert.deepEqual(selected, [3]);
  });
  keyboardHarness({ currentIndex: 3 }, ({ press, selected }) => {
    assert.equal(press('ArrowRight'), false);
    press('ArrowLeft');
    assert.deepEqual(selected, [2]);
  });
});

test('стрелки не забираются у поля, слайдера, модального окна и системных сочетаний', () => {
  keyboardHarness({}, ({ press, selected, Target, setModal }) => {
    assert.equal(press('ArrowRight', { target: new Target(true) }), false);
    for (const flag of [
      'defaultPrevented',
      'isComposing',
      'repeat',
      'altKey',
      'ctrlKey',
      'metaKey',
      'shiftKey',
    ]) {
      assert.equal(press('ArrowRight', { [flag]: true }), false, flag);
    }
    setModal(true);
    assert.equal(press('ArrowRight'), false);
    assert.deepEqual(selected, []);
  });
  keyboardHarness({ enabled: false }, ({ listeners, press, selected }) => {
    assert.equal(listeners.size, 0);
    assert.equal(press('ArrowRight'), false);
    assert.deepEqual(selected, []);
  });
});

test('удержание указателя блокирует смену задачи до release/cancel/blur', () => {
  keyboardHarness({}, ({ listeners, press, selected }) => {
    for (const end of ['pointerup', 'pointercancel', 'blur']) {
      listeners.get('pointerdown')({ pointerId: 7 });
      assert.equal(press('ArrowRight'), false);
      listeners.get(end)({ pointerId: 7 });
      assert.equal(press('ArrowRight'), true);
    }
    assert.deepEqual(selected, [2, 2, 2]);
  });
});

test('форма рисунка сохраняется при повороте и zoom, миграция идемпотентна', () => {
  const { migrateDrawingToWorkspace, drawingPointDistance, drawingBottom } =
    load('@/lib/task-drawing');
  const old = [
    {
      id: 'square',
      coordinateSpace: 'workspace',
      points: [
        { x: 0.1, y: 100 },
        { x: 0.2, y: 100 },
        { x: 0.2, y: 200 },
      ],
    },
  ];
  const migrated = migrateDrawingToWorkspace(old, 600, 1000);
  for (const width of [1000, 600, 1000]) {
    const [a, b, c] = migrated[0].points;
    assert.equal(drawingPointDistance(a, b, width), drawingPointDistance(b, c, width));
    assert.equal(drawingBottom(migrated, width), 0.2 * width);
  }
  assert.equal(migrated[0].points[0].y * 1000, 100);
  assert.deepEqual(migrateDrawingToWorkspace(migrated, 900, 600), migrated);
  const legacy = [{ id: 'old', points: [{ x: 0.2, y: 0.5 }] }];
  assert.equal(migrateDrawingToWorkspace(legacy, 600, 1000)[0].points[0].y, 0.3);
});

test('оба ластика работают в общей системе координат после поворота', () => {
  const { eraseDrawingAt } = load('@/lib/task-drawing');
  const strokes = [
    {
      id: 'line',
      coordinateSpace: 'width',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
      ],
    },
  ];
  for (const width of [375, 844]) {
    assert.equal(eraseDrawingAt(strokes, { x: 0.3, y: 0.1 }, width, 'stroke-eraser').length, 0);
    const parts = eraseDrawingAt(strokes, { x: 0.3, y: 0.1 }, width, 'point-eraser');
    assert.equal(parts.length, 2);
    assert.ok(parts.every((s) => s.coordinateSpace === 'width'));
  }
});

test('полностью стёртый рисунок остаётся dirty до подтверждения сервера', () => {
  const { useTasksStore } = loader()('@/stores/tasks-store');
  const store = useTasksStore.getState();
  const stroke = {
    id: 'line',
    points: [
      { x: 0.1, y: 20 },
      { x: 0.3, y: 30 },
    ],
  };
  store.setDrawing('server-item', [stroke]);
  store.commitDrawing('server-item');
  store.acknowledge('server-item', useTasksStore.getState().savedDrawings['server-item']);
  store.setDrawing('server-item', []);
  store.commitDrawing('server-item');
  const cleared = useTasksStore.getState().savedDrawings['server-item'];
  assert.deepEqual(cleared, []);
  assert.equal(Object.hasOwn(useTasksStore.getState().savedDrawings, 'server-item'), true);
  store.acknowledge('server-item', cleared);
  assert.equal(Object.hasOwn(useTasksStore.getState().savedDrawings, 'server-item'), false);
});

test('пять уровней сложности: строгие края, плавные веса и неизвестная оценка', () => {
  const { difficultyMixAt, isDifficultyEligible, allocateDifficultyCounts } =
    loader()('@/lib/task-difficulty');
  assert.deepEqual(difficultyMixAt(0), { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
  const middle = difficultyMixAt(50);
  assert.equal(middle[2] + middle[3], 0.9);
  assert.deepEqual(
    Object.keys(difficultyMixAt(100)).filter((key) => difficultyMixAt(100)[key] > 0),
    ['4', '5'],
  );
  assert.equal(isDifficultyEligible(null, 0), false);
  assert.equal(isDifficultyEligible(null, 100), false);
  assert.equal(isDifficultyEligible(null, 50), true);
  for (let position = 0; position <= 100; position += 1) {
    const mix = difficultyMixAt(position);
    assert.ok(Math.abs(Object.values(mix).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.equal(
      Object.values(allocateDifficultyCounts(17, position)).reduce((sum, value) => sum + value, 0),
      17,
    );
    if (position > 0) {
      const previous = difficultyMixAt(position - 1);
      assert.ok(Object.keys(mix).every((key) => Math.abs(mix[key] - previous[key]) < 0.04));
    }
  }
});

test('неоценённые задачи идут только после оценённых и не попадают на края шкалы', () => {
  const { selectTrainingTasks } = loader()('@/lib/task-training');
  const tasks = [
    { id: 'unknown', difficulty: null },
    { id: 'rated', difficulty: 3 },
    { id: 'grob', difficulty: 5 },
  ];
  const input = { tasks, difficulties: [1, 2, 3, 4, 5], count: 3, history: {} };
  assert.deepEqual(
    selectTrainingTasks({ ...input, difficultyLevel: 50 }).map((task) => task.id),
    ['rated', 'grob', 'unknown'],
  );
  assert.deepEqual(
    selectTrainingTasks({ ...input, difficultyLevel: 100 }).map((task) => task.id),
    ['grob'],
  );
  assert.deepEqual(selectTrainingTasks({ ...input, difficultyLevel: 0 }), []);
});

test('ползунок обновляет доступность и сохраняет количество; дефицит блокирует старт', () => {
  const { loadSetup, render } = setupHarness({ fixedExamNumber: 1 });
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  setup.update(1, { count: 6 });
  setup = render(hook);
  setup.setDifficultyLevel(0);
  setup = render(hook);
  assert.equal(setup.selections[0].count, 6);
  assert.equal(setup.available(setup.selections[0]), 3);
  assert.equal(setup.canStart, false);
  setup.setDifficultyLevel(100);
  setup = render(hook);
  assert.equal(setup.available(setup.selections[0]), 0);
  assert.equal(setup.shortage, true);
  assert.equal(setup.canStart, false);
});

test('сборщик открывается отдельно, без создания попытки', () => {
  const { paths, requests, loadSetup, render } = setupHarness();
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  catalog.openSetup();
  assert.deepEqual(paths, ['/training/setup']);
  assert.equal(requests.length, 0);
});

test('быстрый повторный клик по номеру открывает настройку один раз', () => {
  const { paths, requests, loadSetup, render } = setupHarness();
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  catalog.openNumber(1);
  catalog.openNumber(1);
  assert.deepEqual(paths, ['/training/setup?examNumber=1']);
  assert.equal(requests.length, 0);
});

test('запуск тренировки блокирует повторное создание попытки', async () => {
  const { requests, loadSetup, render } = setupHarness({ fixedExamNumber: 1 });
  const setup = render(loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage);
  await Promise.all([setup.start(), setup.start()]);
  assert.equal(requests.length, 1);
});

test('повтор после потери соединения сохраняет idempotency key запроса', async () => {
  const { requests, loadSetup, render } = setupHarness({
    failFirstRequest: true,
    fixedExamNumber: 1,
  });
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  await setup.start();
  setup = render(hook);
  assert.equal(setup.busy, false);
  assert.equal(setup.error, 'Connection lost');
  await setup.start();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].key, requests[1].key);
});

test('можно выбрать несколько тем, повторное нажатие снимает выбор', () => {
  const { loadSetup, render } = setupHarness();
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  setup.toggle(1);
  setup = render(hook);
  setup.toggleTopic(1, 'triangle');
  setup = render(hook);
  setup.toggleTopic(1, 'circle');
  setup = render(hook);
  assert.deepEqual(setup.selections[0].topicIds, ['triangle', 'circle']);
  setup.toggleTopic(1, 'triangle');
  setup = render(hook);
  assert.deepEqual(setup.selections[0].topicIds, ['circle']);
  setup.toggleTopic(1);
  setup = render(hook);
  assert.deepEqual(setup.selections[0].topicIds, []);
});

test('короткий ответ получает понятный результат без баллов 1 из 1', () => {
  const { attemptFeedback } = loader()('@/lib/attempt-feedback');
  const item = {
    id: 'short',
    task: { responseType: 'short' },
    result: { isGraded: true, score: 1, maxScore: 1 },
  };
  assert.equal(attemptFeedback(item, false).label, 'Верно');
  assert.equal(attemptFeedback(item, false).hasDetails, false);
  assert.equal(
    attemptFeedback({ ...item, result: { ...item.result, score: 0 } }, false).label,
    'Пока неверно',
  );
});

test('разбор фото раскрывает человеческий текст и не публикует служебный JSON', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const feedback = {
    ocr: 'INTERNAL_OCR_DATA',
    analysis: {
      summary: 'Потерян один корень',
      errors: [
        {
          id: 'domain',
          code: 'INTERNAL_ERROR_CODE',
          description: 'Не учтено ограничение',
          where: 'Вторая строка',
          correctVersion: 'Проверь знаменатель',
          advice: 'Подставь оба корня',
        },
      ],
    },
    grading: { explanation: 'За верный ход решения сохранён балл' },
  };
  const item = {
    id: 'photo',
    task: { responseType: 'photo' },
    result: { isGraded: true, score: 1, maxScore: 2, feedback },
  };
  const { AttemptFeedback } = loader()('@/components/tasks/AttemptFeedback');
  const html = renderToStaticMarkup(
    createElement(AttemptFeedback, {
      item,
      busy: false,
      canReviewPhoto: true,
      onCancel() {},
      onRetry() {},
    }),
  );
  for (const text of [
    '1 из 2 баллов',
    'Потерян один корень',
    'Вторая строка',
    'Проверь знаменатель',
    'Подставь оба корня',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('<details'));
  assert.ok(!html.includes('<pre'));
  assert.ok(!html.includes('INTERNAL_OCR_DATA'));
  assert.ok(!html.includes('INTERNAL_ERROR_CODE'));
});

test('действия черновика, проверки и повтора сохраняют точный смысл', () => {
  const { attemptFeedback } = loader()('@/lib/attempt-feedback');
  const item = {
    task: { responseType: 'photo', gradingCapability: 'available' },
    submission: { status: 'draft', images: [{ id: 'image' }] },
  };
  assert.equal(
    attemptFeedback({ ...item, submission: { ...item.submission, images: [] } }, true),
    null,
  );
  assert.equal(attemptFeedback(item, true).label, 'Решение готово к проверке');
  assert.equal(attemptFeedback(item, true).canCancel, false);
  for (const gradingCapability of ['unsupported', 'unavailable']) {
    const saved = attemptFeedback({ ...item, task: { ...item.task, gradingCapability } }, true);
    assert.equal(saved.label, 'Решение сохранено');
    assert.equal(saved.canCancel, false);
  }
  const queued = attemptFeedback(
    { ...item, submission: { ...item.submission, status: 'queued' } },
    true,
  );
  assert.equal(queued.cancelLabel, 'Отменить проверку');
  assert.equal(queued.canCancel, true);
  const failed = attemptFeedback(
    {
      ...item,
      submission: { ...item.submission, status: 'failed', retryable: true },
    },
    true,
  );
  assert.equal(failed.canRetry, true);
  assert.equal(failed.canCancel, false);
});

test('большое избранное явно предлагает первые 50 задач и отправляет допустимый набор', async () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { loadSetup, requests, render } = setupHarness();
  const tasks = Array.from({ length: 55 }, (_, index) => ({
    id: `favorite-${index}`,
    examNumber: 1,
    content: [{ type: 'text', value: `Условие ${index}` }],
  }));
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  await catalog.openFavorites(tasks);
  assert.equal(requests[0].request.taskIds.length, 50);
  assert.deepEqual(
    requests[0].request.taskIds,
    tasks.slice(0, 50).map((task) => task.id),
  );
  const { FavoritesGrid } = loader()('@/components/tasks/FavoritesGrid');
  const html = renderToStaticMarkup(
    createElement(FavoritesGrid, { tasks, onOpenAll() {}, onOpenTask() {} }),
  );
  assert.ok(html.includes('Решить первые 50 задач'));
  assert.ok(!html.includes('Решать все избранные'));
  assert.ok(html.includes('Условие 54'));
  assert.equal((html.match(/>Решить задачу</g) ?? []).length, tasks.length);
});

test('одиночная задача за пределом общей подборки остаётся доступной', async () => {
  const { loadSetup, requests, render } = setupHarness();
  const catalog = render(loadSetup('@/hooks/use-task-catalog').useTaskCatalog);
  await catalog.openFavorites([{ id: 'favorite-54' }]);
  assert.deepEqual(requests[0].request.taskIds, ['favorite-54']);
});

test('граница сложности честно сужает банк, не заменяя количество и темы ученика', async () => {
  const { loadSetup, tasks, requests, render } = setupHarness();
  tasks.splice(
    0,
    tasks.length,
    ...Array.from({ length: 17 }, (_, index) => ({
      id: `edge-task-${index}`,
      examNumber: 1,
      difficulty: index === 0 ? 5 : index === 1 ? null : 2,
      isGrob: index === 0,
      topicIds: ['chosen-topic'],
    })),
  );
  const hook = loadSetup('@/hooks/use-training-setup-page').useTrainingSetupPage;
  let setup = render(hook);
  setup.toggle(1);
  setup = render(hook);
  setup.update(1, { count: 5 });
  setup.toggleTopic(1, 'chosen-topic');
  setup = render(hook);
  assert.equal(setup.available(setup.selections[0]), 17);
  const choice = setup.selections[0];
  for (const level of [99, 100, 99, 0, 1, 50]) {
    setup.setDifficultyLevel(level);
    setup = render(hook);
    assert.deepEqual(setup.selections[0], choice);
    assert.deepEqual(
      setup.numbers[0].countOptions.map((option) => option.count),
      [3, 5, 10, 20],
    );
    assert.equal(setup.available(choice), level === 100 ? 1 : level === 0 ? 0 : 17);
    assert.equal(setup.canStart, level !== 0 && level !== 100);
  }
  setup.setDifficultyLevel(100);
  setup = render(hook);
  assert.equal(setup.numbers[0].adjustmentCount, 1);
  await setup.start();
  assert.equal(requests.length, 0);
  setup.update(1, { count: setup.numbers[0].adjustmentCount });
  setup = render(hook);
  assert.equal(setup.canStart, true);
  assert.equal(setup.selections[0].count, 1);
  assert.deepEqual(
    setup.numbers[0].countOptions.map((option) => option.count),
    [1, 5, 10, 20],
  );
  await setup.start();
  assert.equal(requests[0].request.difficultyPreference, 100);
  assert.equal(requests[0].request.selections[0].count, 1);
  assert.deepEqual(requests[0].request.selections[0].topicIds, ['chosen-topic']);
});

test('доступность номера и тем учитывает только допустимые уникальные задачи на всех позициях шкалы', () => {
  const { availableTrainingTasks, trainingNumberOptions } = loader()('@/lib/training-setup');
  const tasks = [
    { examNumber: 1, difficulty: 1, topicIds: ['a', 'b'] },
    { examNumber: 1, difficulty: 2, topicIds: ['a'] },
    { examNumber: 1, difficulty: 4, topicIds: ['b'] },
    { examNumber: 1, difficulty: 5, topicIds: ['a', 'b'] },
    { examNumber: 1, difficulty: null, topicIds: ['a'] },
    { examNumber: 2, difficulty: 5, topicIds: ['a'] },
  ];
  const selection = { examNumber: 1, count: 5, topicIds: ['a', 'b'] };
  const numbers = [{ examNumber: 1, topics: [{ id: 'a' }, { id: 'b' }] }];
  for (let level = 0; level <= 100; level++) {
    const expected = level === 0 ? 1 : level === 100 ? 2 : 5;
    const [number] = trainingNumberOptions(numbers, tasks, [selection], level);
    assert.equal(availableTrainingTasks(tasks, selection, level), expected);
    assert.equal(number.available, expected);
    assert.equal(number.adjustmentCount, expected < selection.count ? expected : null);
    assert.deepEqual(
      number.topics.map((topic) => topic.available),
      level === 0 ? [1, 1] : level === 100 ? [1, 2] : [4, 3],
    );
    assert.ok(number.topics.every((topic) => topic.selected));
  }
});
