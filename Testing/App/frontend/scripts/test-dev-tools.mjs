import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deferred, hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

function setupDevTools({ mock = false, enabled = true } = {}) {
  const harness = hookHarness();
  const calls = [];
  const navigation = [];
  let user = { id: 'student', email: 'student@example.test', plan: 'free' };
  let logout = async () => {
    user = null;
  };
  const auth = {
    get user() {
      return user;
    },
    setUser: (value) => {
      calls.push('setUser');
      user = value;
    },
    logout: async () => {
      calls.push('logout');
      await logout();
    },
  };
  const load = moduleLoader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push: (path) => navigation.push(path) }) },
    '@/config/env': { IS_MOCK_API: mock, DEV_TOOLS_ENABLED: enabled, APP_ENV: 'dev' },
    '@/stores/auth-store': { useAuthStore: (select) => select(auth) },
    '@/stores/onboarding-store': {
      useOnboardingStore: (select) => select({ reset: () => calls.push('resetDraft') }),
    },
    '@/stores/profile-store': {
      useProfileStore: (select) => select({ reset: () => calls.push('resetProfile') }),
    },
    '@/lib/api/auth': {
      loginUser: async () => {
        calls.push('login');
        return { id: 'demo', plan: 'free' };
      },
    },
    '@/lib/api/billing': {
      changePlan: async (plan) => {
        calls.push('plan');
        return { ...user, plan };
      },
    },
    '@/stores/mock-exam-demo-store': {
      useMockExamDemoStore: {
        getState: () => {
          calls.push('readDemo');
          return { resetRevision: 0, reset: () => calls.push('resetDemo') };
        },
      },
    },
    '@/stores/mock-exams-store': {
      useMockExamsStore: {
        getState: () => {
          calls.push('readMockExams');
          return {
            start: () => calls.push('startMockExam'),
            setCurrentIndex: () => calls.push('setMockTask'),
            resetExam: () => calls.push('resetMockExam'),
          };
        },
      },
    },
    '@/stores/tasks-store': {
      useTasksStore: {
        getState: () => {
          calls.push('readTasks');
          return {
            drawings: {},
            savedDrawings: {},
            history: {},
            solvedAt: {},
            resetTaskProgress: () => calls.push('resetTasks'),
          };
        },
      },
    },
  });

  return {
    render: () => harness.render(() => load('@/hooks/use-dev-tools').useDevTools(() => {})),
    calls,
    navigation,
    config: load('@/config/dev'),
    setLogout: (callback) => {
      logout = callback;
    },
  };
}

test('dev tools are available in local and dev with either API, and absent in prod', () => {
  for (const environment of ['local', 'dev', 'prod']) {
    for (const api of ['0', '1']) {
      const load = moduleLoader(
        {},
        { process: { env: { NEXT_PUBLIC_APP_ENV: environment, NEXT_PUBLIC_API_MOCK: api } } },
      );
      const env = load('@/config/env');
      assert.equal(env.DEV_TOOLS_ENABLED, environment !== 'prod');
      assert.equal(env.IS_MOCK_API, api === '1');
    }
  }
});

test('real API panel cannot touch demo stores, test accounts or plans and resets only onboarding draft', async () => {
  const s = setupDevTools();
  const state = s.render();
  assert.deepEqual(s.calls, []);
  await state.handleLogin();
  await state.handlePlan('pro');
  state.handleOpenMockExam();
  await state.handleResetMockExam();
  assert.deepEqual(s.calls, []);

  for (const path of ['/lesson', '/streak', s.config.DEV_DEMO_TASK_PATH]) {
    assert.equal(
      s.config.DEV_SCREENS.some((screen) => screen.href === path),
      false,
    );
    state.go(path);
  }
  assert.deepEqual(s.navigation, []);
  state.go('/home');
  assert.deepEqual(s.navigation, ['/home']);
  state.handleReset();
  assert.deepEqual(s.calls, ['resetDraft']);
});

test('real logout uses the session action once and recovers after failure', async () => {
  const s = setupDevTools();
  const gate = deferred();
  s.setLogout(() => gate.promise);
  const state = s.render();
  const pending = state.handleLogout();
  await state.handleLogout();
  assert.deepEqual(s.calls, ['logout']);
  assert.equal(s.render().pending, true);
  gate.reject(new Error('offline'));
  await pending;
  assert.equal(s.render().pending, false);
  assert.equal(s.render().note, s.config.DEV_COPY.actionFailed);
  s.setLogout(async () => {});
  await s.render().handleLogout();
  assert.deepEqual(s.calls, ['logout', 'logout']);
});

test('mock API retains account, plan, profile reset and demo actions', async () => {
  const s = setupDevTools({ mock: true });
  const state = s.render();
  assert.ok(s.calls.includes('resetDemo'));
  s.calls.length = 0;
  await state.handleLogin();
  await s.render().handlePlan('pro');
  s.render().handleReset();
  s.render().handleOpenMockExam();
  await s.render().handleResetMockExam();
  for (const call of [
    'login',
    'plan',
    'resetDraft',
    'resetProfile',
    'startMockExam',
    'resetDemo',
  ]) {
    assert.ok(s.calls.includes(call), call);
  }
  assert.deepEqual(s.navigation, ['/home', s.config.DEV_DEMO_TASK_PATH]);
});

test('disabled real panel cannot execute actions even if called directly', async () => {
  const s = setupDevTools({ enabled: false });
  const state = s.render();
  state.go('/home');
  state.handleReset();
  await state.handleLogout();
  await state.handleLogin();
  await state.handlePlan('pro');
  state.handleOpenMockExam();
  await state.handleResetMockExam();
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.navigation, []);
});
