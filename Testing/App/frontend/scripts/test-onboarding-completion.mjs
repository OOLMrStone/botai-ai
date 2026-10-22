import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleLoader, hookHarness, deferred } from './helpers/hook-harness.mjs';

function setup(status = 'anonymous', mock = false) {
  const harness = hookHarness();
  let user = status === 'authenticated' ? { id: 'owner' } : null;
  const navigation = [],
    requests = [];
  let resets = 0,
    needed = false;
  let save = async () => {};
  const choices = {
    goal: 'good',
    level: 'basics',
    dailyGoalMinutes: 45,
    notificationsEnabled: false,
    reset: () => resets++,
    requireProfileSave: () => {
      needed = true;
    },
  };
  const routes = { home: '/home', lesson: '/lesson' };
  const load = moduleLoader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push: (url) => navigation.push(url) }) },
    '@/hooks/use-auth-session': { useAuthSession: () => ({ status, retry() {} }) },
    '@/config/env': { IS_MOCK_API: mock },
    '@/config/onboarding-steps': {
      ONBOARDING_DESTINATION: mock ? '/lesson' : '/register/save-progress',
      ROUTES: routes,
    },
    '@/lib/api/onboarding': {
      saveOnboarding: async (payload) => {
        requests.push(payload);
        await save();
      },
    },
    '@/stores/onboarding-store': { useOnboardingStore: { getState: () => choices } },
    '@/stores/auth-store': { useAuthStore: { getState: () => ({ user }) } },
  });
  const render = () =>
    harness.render(() => load('@/hooks/use-complete-onboarding').useCompleteOnboarding());
  return {
    render,
    navigation,
    requests,
    resets: () => resets,
    needed: () => needed,
    setSave(fn) {
      save = fn;
    },
    changeOwner(next) {
      user = next;
    },
  };
}

test('real guest ready reaches registration while retaining choices; mock demo route remains', async () => {
  const guest = setup();
  await guest.render().start();
  assert.deepEqual(guest.navigation, ['/register/save-progress']);
  assert.equal(guest.needed(), true);
  assert.equal(guest.resets(), 0);
  assert.equal(guest.requests.length, 0);
  const mock = setup('anonymous', true);
  mock.render().start();
  assert.deepEqual(mock.navigation, ['/lesson']);
});

test('authenticated ready/done await saved choices before HOME', async () => {
  const s = setup('authenticated');
  const gate = deferred();
  s.setSave(() => gate.promise);
  const pending = s.render().finish();
  assert.deepEqual(s.navigation, []);
  assert.equal(s.resets(), 0);
  assert.equal(s.render().pending, true);
  gate.resolve();
  await pending;
  assert.deepEqual(s.navigation, ['/home']);
  assert.equal(s.resets(), 1);
  assert.deepEqual(s.requests, [
    { goal: 'good', level: 'basics', dailyGoalMinutes: 45, notificationsEnabled: false },
  ]);
});

test('onboarding transport failure retains choices and permits retry', async () => {
  const s = setup('authenticated');
  s.setSave(async () => {
    throw new Error('offline');
  });
  await s.render().finish();
  assert.equal(s.resets(), 0);
  assert.deepEqual(s.navigation, []);
  assert.equal(s.render().error, 'offline');
  s.setSave(async () => {});
  await s.render().finish();
  assert.deepEqual(s.navigation, ['/home']);
  assert.equal(s.resets(), 1);
});

test('late completion from old owner cannot reset new owner or navigate', async () => {
  const s = setup('authenticated');
  const gate = deferred();
  s.setSave(() => gate.promise);
  const pending = s.render().finish();
  s.changeOwner({ id: 'other' });
  gate.resolve();
  await pending;
  assert.equal(s.resets(), 0);
  assert.deepEqual(s.navigation, []);
});

function setupLogin() {
  const harness = hookHarness();
  const navigation = [],
    requests = [];
  let user = null;
  let needed = false;
  let login = async () => ({ id: 'student' });
  const load = moduleLoader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push: (path) => navigation.push(path) }) },
    '@/lib/api/auth': {
      loginUser: async (payload) => {
        requests.push(payload);
        return login(payload);
      },
    },
    '@/stores/auth-store': {
      useAuthStore: {
        getState: () => ({
          setUser: (next) => {
            user = next;
          },
        }),
      },
    },
    '@/stores/onboarding-store': {
      useOnboardingStore: { getState: () => ({ needsProfileSave: needed }) },
    },
  });
  return {
    render: () => harness.render(() => load('@/hooks/use-login').useLogin()),
    navigation,
    requests,
    user: () => user,
    setLogin: (fn) => {
      login = fn;
    },
    requireProfileSave: () => {
      needed = true;
    },
  };
}

test('login ignores invalid forms and duplicate submits, trims email, and retains pending onboarding', async () => {
  const s = setupLogin();
  await s.render().submit();
  assert.equal(s.requests.length, 0);
  s.render().setEmail('  student@example.test  ');
  s.render().setPassword('a-password');
  s.requireProfileSave();
  const gate = deferred();
  s.setLogin(() => gate.promise);
  const ready = s.render();
  const pending = ready.submit();
  await ready.submit();
  assert.deepEqual(s.requests, [{ email: 'student@example.test', password: 'a-password' }]);
  assert.equal(s.render().pending, true);
  gate.resolve({ id: 'student' });
  await pending;
  assert.deepEqual(s.navigation, ['/register/done']);
  assert.deepEqual(s.user(), { id: 'student' });
});

test('failed login retains entered values, restores action and permits retry', async () => {
  const s = setupLogin();
  s.render().setEmail('student@example.test');
  s.render().setPassword('a-password');
  s.setLogin(async () => {
    throw new Error('offline');
  });
  await s.render().submit();
  assert.equal(s.render().pending, false);
  assert.ok(s.render().error);
  assert.equal(s.render().email, 'student@example.test');
  assert.equal(s.render().password, 'a-password');
  s.setLogin(async () => ({ id: 'student' }));
  await s.render().submit();
  assert.deepEqual(s.navigation, ['/home']);
  assert.equal(s.requests.length, 2);
});

function setupCommitmentSeal() {
  const harness = hookHarness();
  const timers = new Map();
  let nextTimer = 0;
  const load = moduleLoader(
    { react: harness.react },
    {
      setTimeout(callback, delay) {
        timers.set(++nextTimer, { callback, delay });
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    render: () => harness.render(() => load('@/hooks/use-commitment-seal').useCommitmentSeal()),
    unmount: harness.unmount,
    timers,
    constants: load('@/config/constants').COMMITMENT_SEAL,
    finishHold() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach(({ callback }) => callback());
    },
  };
}

const sealPointer = (overrides = {}) => ({
  pointerId: 1,
  isPrimary: true,
  clientX: 0,
  clientY: 0,
  currentTarget: { setPointerCapture() {} },
  ...overrides,
});

test('commitment Enter and Space seal immediately without a timer or a keyup hold', () => {
  for (const key of ['Enter', ' ']) {
    const s = setupCommitmentSeal();
    let prevented = false;
    s.render().activateFromKeyboard({
      key,
      repeat: false,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(s.render().isSealed, true);
    assert.equal(s.render().isHolding, false);
    assert.equal(s.timers.size, 0);
    assert.equal(prevented, true);
    s.render().cancelHold();
    assert.equal(s.render().isSealed, true);
  }
});

test('commitment ignores repeating activation and unrelated keys', () => {
  for (const event of [
    { key: 'Enter', repeat: true },
    { key: ' ', repeat: true },
    { key: 'ArrowRight', repeat: false },
    { key: 'Escape', repeat: false },
  ]) {
    const s = setupCommitmentSeal();
    s.render().activateFromKeyboard({ ...event, preventDefault() {} });
    assert.equal(s.render().isSealed, false);
    assert.equal(s.timers.size, 0);
  }
});

test('commitment pointer still requires the complete hold and ignores a short press', () => {
  const s = setupCommitmentSeal();
  s.render().startHold(sealPointer());
  assert.equal(s.render().isHolding, true);
  assert.equal(s.render().isSealed, false);
  assert.equal([...s.timers.values()][0].delay, s.constants.holdDurationMs);
  s.render().endHold(sealPointer());
  s.finishHold();
  assert.equal(s.render().isSealed, false);
  assert.equal(s.render().isHolding, false);

  s.render().startHold(sealPointer());
  s.finishHold();
  assert.equal(s.render().isSealed, true);
  assert.equal(s.render().isHolding, false);
  s.render().endHold(sealPointer());
  assert.equal(s.render().isSealed, true);
});

test('commitment moving away or unmounting cancels pending pointer completion', () => {
  const s = setupCommitmentSeal();
  s.render().startHold(sealPointer());
  s.render().trackHold(sealPointer({ clientX: s.constants.moveTolerancePx + 1 }));
  s.finishHold();
  assert.equal(s.render().isSealed, false);
  assert.equal(s.render().isHolding, false);
  s.render().startHold(sealPointer());
  s.unmount();
  assert.equal(s.timers.size, 0);
});

test('onboarding skips removed building and notification steps in every API mode', () => {
  for (const mock of [false, true]) {
    const flow = moduleLoader({ '@/config/env': { IS_MOCK_API: mock } })(
      '@/config/onboarding-steps',
    );
    assert.equal(flow.ONBOARDING_STEPS.includes('building'), false);
    assert.equal(flow.ONBOARDING_STEPS.includes('notifications'), false);
    assert.equal(flow.nextOnboardingSlug('daily-goal-result'), 'commitment');
    assert.equal(flow.nextOnboardingPath('building'), '/onboarding/commitment');
    assert.equal(flow.nextOnboardingPath('notifications'), '/onboarding/commitment');
    assert.equal(flow.nextOnboardingSlug('ready'), null);
    assert.equal(flow.nextOnboardingPath('ready'), mock ? '/lesson' : '/register/save-progress');
  }
});

test('direct routes of removed onboarding steps redirect to the next active step', () => {
  for (const mock of [false, true]) {
    const navigation = [];
    const redirected = new Error('redirected');
    const load = moduleLoader({
      '@/config/env': { IS_MOCK_API: mock },
      'next/navigation': {
        redirect: (path) => {
          navigation.push(path);
          throw redirected;
        },
      },
    });
    for (const step of ['building', 'notifications']) {
      const Page = load('@/app/(learning)/onboarding/' + step + '/page').default;
      assert.throws(Page, (cause) => cause === redirected);
    }
    assert.deepEqual(navigation, ['/onboarding/commitment', '/onboarding/commitment']);
  }
});

function setupEmailVerification(initialToken = null) {
  const harness = hookHarness();
  const requests = [];
  let token = initialToken;
  let user = null;
  let sessionStatus = 'anonymous';
  let verify = async () => {};
  let refresh = async () => user;
  const store = (select) => select({ user });
  store.getState = () => ({ refresh });
  const load = moduleLoader({
    react: harness.react,
    'next/navigation': { useSearchParams: () => ({ get: () => token }) },
    '@/hooks/use-auth-session': {
      useAuthSession: () => ({ status: sessionStatus, retry() {} }),
    },
    '@/lib/api/auth': {
      verifyEmail: async (value) => {
        requests.push(value);
        await verify();
      },
    },
    '@/stores/auth-store': { useAuthStore: store },
  });
  const { ApiError } = load('@/lib/api/client');
  return {
    render: () =>
      harness.render(() => load('@/hooks/use-email-verification').useEmailVerification()),
    requests,
    invalidCode: () => new ApiError(401, 'Invalid or expired verification link', 'invalid_code'),
    setToken: (value) => {
      token = value;
    },
    setVerify: (fn) => {
      verify = fn;
    },
    failRefresh: () => {
      refresh = async () => {
        sessionStatus = 'error';
        throw new Error('offline');
      };
    },
    signIn: () => {
      user = { id: 'student' };
      sessionStatus = 'authenticated';
    },
  };
}

test('verification never submits missing tokens or on mount, and returns according to session', async () => {
  const s = setupEmailVerification('   ');
  assert.equal(s.render().canConfirm, false);
  assert.equal(s.render().returnHref, '/login');
  await s.render().confirm();
  assert.equal(s.requests.length, 0);

  s.setToken('a-token');
  assert.equal(s.render().canConfirm, true);
  assert.equal(s.requests.length, 0);
  s.signIn();
  assert.equal(s.render().returnHref, '/settings');
});

test('verification prevents duplicate clicks and remains successful if session refresh fails', async () => {
  const s = setupEmailVerification('a-token');
  const gate = deferred();
  s.setVerify(() => gate.promise);
  s.failRefresh();
  const ready = s.render();
  const pending = ready.confirm();
  await ready.confirm();
  assert.equal(s.render().pending, true);
  assert.equal(s.render().canConfirm, false);
  assert.deepEqual(s.requests, ['a-token']);

  gate.resolve();
  await pending;
  assert.equal(s.render().done, true);
  assert.equal(s.render().error, null);
  assert.equal(s.render().sessionFailed, true);
  await s.render().confirm();
  assert.equal(s.requests.length, 1);
});

test('invalid or expired links stop confirmation; transport errors allow retry; another token gets a fresh state', async () => {
  const s = setupEmailVerification('expired-token');
  s.setVerify(async () => {
    throw s.invalidCode();
  });
  await s.render().confirm();
  assert.equal(s.render().invalid, true);
  assert.equal(s.render().canConfirm, false);
  assert.doesNotMatch(s.render().title, /Invalid/);

  s.setToken('new-token');
  assert.equal(s.render().invalid, false);
  assert.equal(s.render().canConfirm, true);
  s.setVerify(async () => {
    throw new TypeError('Failed to fetch');
  });
  await s.render().confirm();
  assert.ok(s.render().error);
  assert.equal(s.render().canConfirm, true);

  s.setVerify(async () => {});
  await s.render().confirm();
  assert.equal(s.render().done, true);
  assert.deepEqual(s.requests, ['expired-token', 'new-token', 'new-token']);
});

function setupRegistration() {
  const harness = hookHarness();
  const requests = [],
    navigation = [];
  let user = null;
  let registration = { displayName: '', email: '', password: '' };
  let register = async () => ({ id: 'student' });
  const load = moduleLoader({
    react: harness.react,
    '@/hooks/use-flow-navigation': {
      useRegisterFlow: () => ({ goNext: () => navigation.push('done') }),
    },
    '@/lib/api/auth': {
      registerUser: async (payload) => {
        requests.push(payload);
        return register(payload);
      },
    },
    '@/stores/onboarding-store': {
      useOnboardingStore: (select) =>
        select({
          registration,
          updateRegistration: (data) => {
            registration = { ...registration, ...data };
          },
        }),
    },
    '@/stores/auth-store': {
      useAuthStore: {
        getState: () => ({
          setUser: (next) => {
            user = next;
          },
        }),
      },
    },
  });
  return {
    render: () => harness.render(() => load('@/hooks/use-registration').useRegistration()),
    requests,
    navigation,
    user: () => user,
    setRegister: (fn) => {
      register = fn;
    },
    conflict: () => new (load('@/lib/api/client').ApiError)(409, 'occupied'),
    copy: load('@/config/onboarding-steps').COPY.register.account,
  };
}

test('registration requires all three fields, trims name and email, prevents duplicate submit and clears password after success', async () => {
  const s = setupRegistration();
  await s.render().submit();
  s.render().updateRegistration({ displayName: '   ', email: 'bad', password: 'short' });
  await s.render().submit();
  assert.equal(s.requests.length, 0);
  s.render().updateRegistration({
    displayName: '  Маша  ',
    email: '  student@example.test  ',
    password: 'a-password',
  });
  const gate = deferred();
  s.setRegister(() => gate.promise);
  const ready = s.render();
  const pending = ready.submit();
  await ready.submit();
  assert.equal(s.render().pending, true);
  assert.deepEqual(s.requests, [
    { displayName: 'Маша', email: 'student@example.test', password: 'a-password' },
  ]);
  gate.resolve({ id: 'student' });
  await pending;
  assert.deepEqual(s.navigation, ['done']);
  assert.deepEqual(s.user(), { id: 'student' });
  assert.equal(s.render().registration.password, '');
});

test('registration conflict and transport failure retain fields and allow another attempt', async () => {
  const s = setupRegistration();
  const draft = { displayName: 'Маша', email: 'student@example.test', password: 'a-password' };
  s.render().updateRegistration(draft);
  s.setRegister(async () => {
    throw s.conflict();
  });
  await s.render().submit();
  assert.equal(s.render().error, s.copy.emailTaken);
  assert.equal(s.render().pending, false);
  assert.deepEqual(s.render().registration, draft);
  assert.deepEqual(s.navigation, []);
  s.setRegister(async () => {
    throw new Error('offline');
  });
  await s.render().submit();
  assert.equal(s.render().error, s.copy.error);
  s.setRegister(async () => ({ id: 'student' }));
  await s.render().submit();
  assert.equal(s.requests.length, 3);
  assert.deepEqual(s.navigation, ['done']);
});

test('saved registration migrates legacy names, discards age and never restores password', () => {
  const { restoreRegistration } = moduleLoader()('@/lib/registration');
  assert.deepEqual(
    restoreRegistration({
      firstName: 'Мария',
      lastName: 'Иванова',
      age: '17',
      email: 'student@example.test',
      password: 'secret',
    }),
    {
      displayName: 'Мария Иванова',
      email: 'student@example.test',
      password: '',
    },
  );
  assert.deepEqual(
    restoreRegistration({ displayName: 'Маша', firstName: 'Мария', password: 'secret' }),
    { displayName: 'Маша', email: '', password: '' },
  );
  assert.deepEqual(restoreRegistration(), { displayName: '', email: '', password: '' });
});

test('registration API sends displayName and logs in only after registration succeeds', async () => {
  const requests = [];
  const load = moduleLoader({
    '@/lib/api/client': {
      apiFetch: async (path, options) => {
        requests.push({ path, json: options.json });
        return { id: 'student' };
      },
    },
  });
  const payload = { displayName: 'Маша', email: 'student@example.test', password: 'a-password' };
  const user = await load('@/lib/api/auth').registerUser(payload);
  assert.deepEqual(requests, [
    { path: '/api/auth/register', json: payload },
    { path: '/api/auth/login', json: { email: payload.email, password: payload.password } },
  ]);
  assert.deepEqual(user, { id: 'student' });
});

test('legacy registration routes all redirect to the only active screen', () => {
  const navigation = [];
  const redirected = new Error('redirected');
  const load = moduleLoader({
    'next/navigation': {
      redirect: (path) => {
        navigation.push(path);
        throw redirected;
      },
    },
  });
  for (const step of ['age', 'name', 'email', 'password']) {
    assert.throws(
      load('@/app/(learning)/register/' + step + '/page').default,
      (cause) => cause === redirected,
    );
  }
  assert.deepEqual(navigation, Array(4).fill('/register/account'));
});
