import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

const { AUTH_COOKIE, AUTH_ENDPOINT, AUTH_HEADER } = await import('@/config/auth');
const { API_ERROR_COPY, TIMINGS } = await import('@/config/constants');
const { ApiError, apiFetch } = await import('@/lib/api/client');

function prepare(t, cookie = '') {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
}

function pendingFetch(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function pendingBody(signal, status) {
  return new Response(
    new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    }),
    { status },
  );
}

const timeoutError = { name: 'TimeoutError', message: API_ERROR_COPY.timeout };

test('JSON request preserves credentials, headers and caller signal cleanup', async (t) => {
  prepare(t, `${AUTH_COOKIE.xsrf}=test-token`);
  const caller = new AbortController();
  let requestSignal;
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(path, '/test');
    assert.equal(init.credentials, 'include');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.get(AUTH_HEADER.xsrf), 'test-token');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    assert.equal(init.body, '{"answer":42}');
    requestSignal = init.signal;
    return Response.json({ ok: true });
  });

  assert.deepEqual(await apiFetch('/test', { json: { answer: 42 }, signal: caller.signal }), {
    ok: true,
  });
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  t.mock.timers.tick(TIMINGS.apiRequestTimeoutMs);
  assert.equal(requestSignal.aborted, false);
});

for (const phase of ['headers', 'body', 'problem body', 'csrf headers', 'csrf body']) {
  test(`deadline aborts pending ${phase}`, async (t) => {
    prepare(t);
    const csrf = phase.startsWith('csrf');
    const fetchMock = t.mock.method(globalThis, 'fetch', (path, { signal }) => {
      if (csrf) assert.equal(path, AUTH_ENDPOINT.csrf);
      return phase.endsWith('body')
        ? Promise.resolve(pendingBody(signal, phase === 'problem body' ? 503 : 200))
        : pendingFetch(signal);
    });

    const result = apiFetch('/test', csrf ? { json: {} } : {});
    const rejected = assert.rejects(result, timeoutError);
    await setImmediate();
    t.mock.timers.tick(TIMINGS.apiRequestTimeoutMs);
    await rejected;
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test('CSRF and mutation share one deadline', async (t) => {
  prepare(t);
  let finishCsrf;
  const fetchMock = t.mock.method(globalThis, 'fetch', (path, { signal }) => {
    if (path !== AUTH_ENDPOINT.csrf) return pendingFetch(signal);
    return new Promise((resolve) => {
      finishCsrf = () => {
        document.cookie = `${AUTH_COOKIE.xsrf}=test-token`;
        resolve(new Response(null, { status: 204 }));
      };
    });
  });

  const result = apiFetch('/test', { json: {} });
  const rejected = assert.rejects(result, timeoutError);
  t.mock.timers.tick(TIMINGS.apiRequestTimeoutMs / 2);
  finishCsrf();
  await setImmediate();
  assert.equal(fetchMock.mock.callCount(), 2);
  t.mock.timers.tick(TIMINGS.apiRequestTimeoutMs / 2);
  await rejected;
});

test('CSRF HTTP failure blocks mutation and preserves API detail', async (t) => {
  prepare(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ detail: 'CSRF unavailable' }, { status: 503 }),
  );

  await assert.rejects(apiFetch('/test', { json: {} }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.message, 'CSRF unavailable');
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const preAborted of [false, true]) {
  test(`caller cancellation preserves reason (${preAborted ? 'before' : 'during'} fetch)`, async (t) => {
    prepare(t);
    const caller = new AbortController();
    const reason = new Error('caller cancelled');
    const fetchMock = t.mock.method(globalThis, 'fetch', (_, { signal }) => pendingFetch(signal));
    if (preAborted) caller.abort(reason);

    const result = apiFetch('/test', { signal: caller.signal });
    const rejected = assert.rejects(result, (error) => error === reason);
    if (!preAborted) caller.abort(reason);
    await rejected;
    assert.equal(fetchMock.mock.callCount(), preAborted ? 0 : 1);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });
}

test('non-problem transport HTTP failure has human copy and retains numeric status', async (t) => {
  prepare(t, `${AUTH_COOKIE.xsrf}=test-token`);
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('Proxy unavailable', { status: 500 }),
  );
  await assert.rejects(
    apiFetch('/test', { json: {} }),
    (error) =>
      error instanceof ApiError && error.status === 500 && error.message === API_ERROR_COPY.request,
  );
});
