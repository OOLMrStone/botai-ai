import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const { useAuthStore } = await import('@/stores/auth-store');
const { ApiError } = await import('@/lib/api/client');

const user = {
  id: 'current-user',
  email: 'student@example.test',
  displayName: 'Ученик',
  role: 'USER',
  authProvider: 'LOCAL',
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  useAuthStore.getState().setUser(user);
  useAuthStore.setState({ user: null, status: 'unknown' });
});

test('parallel session checks share one request and release it after success', async (t) => {
  const response = deferred();
  const fetchMock = t.mock.method(globalThis, 'fetch', () => response.promise);
  const first = useAuthStore.getState().refresh();
  const second = useAuthStore.getState().refresh();

  assert.equal(first, second);
  assert.equal(fetchMock.mock.callCount(), 1);
  response.resolve(Response.json(user));
  assert.deepEqual(await first, user);
  assert.equal(useAuthStore.getState().status, 'authenticated');
  assert.deepEqual(useAuthStore.getState().user, user);

  fetchMock.mock.mockImplementation(async () => Response.json(user));
  assert.deepEqual(await useAuthStore.getState().refresh(), user);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('401 resolves to an anonymous session and removes the cached user', async (t) => {
  useAuthStore.getState().setUser(user);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));

  assert.equal(await useAuthStore.getState().refresh(), null);
  assert.equal(useAuthStore.getState().status, 'anonymous');
  assert.equal(useAuthStore.getState().user, null);
});

for (const failure of ['network', 'HTTP 500']) {
  test(`${failure} sets error and permits a successful retry`, async (t) => {
    const networkError = new TypeError('Failed to fetch');
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'network') throw networkError;
      return Response.json({ detail: 'Backend unavailable' }, { status: 500 });
    });

    await assert.rejects(useAuthStore.getState().refresh(), (error) =>
      failure === 'network'
        ? error === networkError
        : error instanceof ApiError && error.status === 500,
    );
    assert.equal(useAuthStore.getState().status, 'error');

    const retryResponse = deferred();
    fetchMock.mock.mockImplementation(() => retryResponse.promise);
    const retry = useAuthStore.getState().refresh();
    assert.equal(useAuthStore.getState().status, 'unknown');
    assert.equal(useAuthStore.getState().refresh(), retry);
    assert.equal(fetchMock.mock.callCount(), 2);
    retryResponse.resolve(Response.json(user));
    await retry;
    assert.equal(useAuthStore.getState().status, 'authenticated');
    assert.deepEqual(useAuthStore.getState().user, user);
  });
}

for (const result of ['401', 'different user', 'network error']) {
  test(`stale ${result} cannot overwrite a completed login`, async (t) => {
    const response = deferred();
    t.mock.method(globalThis, 'fetch', () => response.promise);
    const pending = useAuthStore.getState().refresh();
    const settled = result === 'network error' ? assert.rejects(pending, TypeError) : pending;
    useAuthStore.getState().setUser(user);

    if (result === 'network error') response.reject(new TypeError('Failed to fetch'));
    else if (result === '401') response.resolve(new Response(null, { status: 401 }));
    else response.resolve(Response.json({ ...user, id: 'outdated-user' }));

    await settled;
    assert.equal(useAuthStore.getState().status, 'authenticated');
    assert.deepEqual(useAuthStore.getState().user, user);
  });
}

test('stale request cleanup cannot clear a newer session check', async (t) => {
  const staleResponse = deferred();
  const currentResponse = deferred();
  const fetchMock = t.mock.method(globalThis, 'fetch', () => staleResponse.promise);
  const stale = useAuthStore.getState().refresh();
  useAuthStore.getState().setUser(user);
  fetchMock.mock.mockImplementation(() => currentResponse.promise);
  const current = useAuthStore.getState().refresh();

  staleResponse.resolve(new Response(null, { status: 401 }));
  await stale;
  assert.equal(useAuthStore.getState().status, 'unknown');
  assert.equal(useAuthStore.getState().refresh(), current);
  assert.equal(fetchMock.mock.callCount(), 2);

  currentResponse.resolve(Response.json(user));
  await current;
  assert.equal(useAuthStore.getState().status, 'authenticated');
  assert.deepEqual(useAuthStore.getState().user, user);
});
