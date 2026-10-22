import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { moduleLoader, hookHarness, deferred, settle } from './helpers/hook-harness.mjs';

const id = 'bb509c5f-c7e7-48b8-8951-cf069b66e7fa';
const payment = {
  id,
  offerId: 'light-month-v1',
  purpose: 'one_time',
  offer: {
    id: 'light-month-v1',
    kind: 'one_time',
    plan: 'light',
    period: 'month',
    amount: { value: '299.00', currency: 'RUB' },
    checkLimit: 30,
    durationDays: 30,
    autoRenew: false,
  },
  status: 'pending',
  amount: { value: '299.00', currency: 'RUB' },
  test: true,
  entitlementApplied: false,
  createdAt: '2026-10-08T10:00:00Z',
};
const catalog = {
  mode: 'test',
  testOnly: true,
  offers: [
    {
      id: payment.offerId,
      kind: 'one_time',
      plan: 'light',
      period: 'month',
      amount: payment.amount,
      checkLimit: 30,
      durationDays: 30,
      autoRenew: false,
    },
  ],
};

function paymentSetup() {
  const harness = hookHarness();
  const timers = new Map();
  const listeners = new Map();
  const calls = [];
  let refresh = async () => payment;
  let invalidations = 0;
  let timerId = 0;
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const load = moduleLoader(
    {
      react: harness.react,
      '@/stores/auth-store': {
        useAuthStore: Object.assign((select) => select({ user: { id: 'owner' } }), {
          getState: () => ({ user: { id: 'owner' } }),
        }),
      },
      '@/lib/api/billing': {
        fetchTestPayment: async () => {
          calls.push('get');
          return payment;
        },
        refreshTestPayment: async () => {
          calls.push('refresh');
          return refresh();
        },
        fetchBillingStatus: async () => ({ mode: 'test', testOnly: true, canPurchase: false }),
      },
      '@/lib/profile-resource': {
        profileResource: { invalidate: () => invalidations++, get: async () => ({}) },
      },
      '@/lib/billing-intent': { finishBillingIntent: () => {} },
    },
    {
      document,
      sessionStorage: {},
      setTimeout: (fn) => {
        const key = ++timerId;
        timers.set(key, fn);
        return key;
      },
      clearTimeout: (key) => timers.delete(key),
    },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-payment').useBillingPayment(id));
  return {
    render,
    calls,
    timers,
    document,
    listeners,
    invalidations: () => invalidations,
    setRefresh: (fn) => {
      refresh = fn;
    },
    tick: async () => {
      const [key, fn] = timers.entries().next().value;
      timers.delete(key);
      fn();
      await settle();
    },
    unmount: harness.unmount,
  };
}

test('return polls sequentially while visible and refreshes profile only after test success', async () => {
  const state = paymentSetup();
  state.render();
  await settle();
  assert.deepEqual(state.calls, ['get']);
  assert.equal(state.invalidations(), 0);
  state.document.visibilityState = 'hidden';
  await state.tick();
  assert.deepEqual(state.calls, ['get']);
  state.document.visibilityState = 'visible';
  const response = deferred();
  state.setRefresh(() => response.promise);
  state.listeners.get('visibilitychange')();
  state.listeners.get('visibilitychange')();
  assert.deepEqual(state.calls, ['get', 'refresh']);
  response.resolve({ ...payment, status: 'succeeded', entitlementApplied: true });
  await settle();
  assert.equal(state.render().payment.status, 'succeeded');
  assert.equal(state.invalidations(), 1);
  assert.equal(state.timers.size, 0);
  state.unmount();
});

test('polling is bounded and manual retry starts a fresh bounded cycle', async () => {
  const state = paymentSetup();
  state.render();
  await settle();
  while (state.timers.size) await state.tick();
  assert.equal(state.calls.length, 12);
  assert.equal(state.render().exhausted, true);
  assert.equal(state.invalidations(), 0);
  state.render().retry();
  state.render();
  await settle();
  assert.equal(state.calls.length, 13);
  assert.equal(state.timers.size, 1);
  state.unmount();
  assert.equal(state.timers.size, 0);
});

test('provider error stops polling without fabricating cancellation or granting access', async () => {
  const state = paymentSetup();
  state.render();
  await settle();
  state.setRefresh(async () => {
    throw new TypeError('Offline');
  });
  await state.tick();
  assert.equal(state.render().payment.status, 'pending');
  assert.ok(state.render().error);
  assert.equal(state.timers.size, 0);
  assert.equal(state.invalidations(), 0);
  state.unmount();
});

test('unmount ignores a late successful provider response', async () => {
  const state = paymentSetup();
  state.render();
  await settle();
  const response = deferred();
  state.setRefresh(() => response.promise);
  await state.tick();
  state.unmount();
  response.resolve({ ...payment, status: 'succeeded', entitlementApplied: true });
  await settle();
  assert.equal(state.invalidations(), 0);
  assert.equal(state.timers.size, 0);
});

test('checkout blocks double click and reuses persisted key after a failed request', async () => {
  const harness = hookHarness();
  const values = new Map();
  const calls = [];
  const routes = [];
  const sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = (select) => select({ user: { id: 'owner' } });
  store.getState = () => ({ user: { id: 'owner' } });
  let response = deferred();
  const load = moduleLoader(
    {
      react: harness.react,
      'next/navigation': { useRouter: () => ({ push: (path) => routes.push(path) }) },
      '@/stores/auth-store': { useAuthStore: store },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => catalog,
        fetchBillingStatus: async () => ({ mode: 'test', testOnly: true, canPurchase: true }),
        createTestPayment: async (offer, key) => {
          calls.push({ offer, key });
          assert.equal(values.size, 1);
          return response.promise;
        },
      },
    },
    {
      sessionStorage,
      window: { location: { assign: () => assert.fail('No provider URL in fixture') } },
    },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox());
  render();
  await settle();
  const screen = render();
  const first = screen.submit();
  await screen.submit();
  assert.equal(calls.length, 1);
  response.reject(new TypeError('Lost response'));
  await first;
  assert.ok(render().intent);
  assert.ok(render().error);
  response = deferred();
  const retry = render().submit();
  assert.equal(calls[0].key, calls[1].key);
  response.resolve(payment);
  await retry;
  assert.equal(routes.length, 1);
  assert.match(routes[0], /\/billing\/return\?paymentId=/);
  harness.unmount();
});

test('disabled capability never creates a payment', async () => {
  const harness = hookHarness();
  let creates = 0;
  const load = moduleLoader(
    {
      react: harness.react,
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/stores/auth-store': {
        useAuthStore: Object.assign((select) => select({ user: { id: 'owner' } }), {
          getState: () => ({ user: { id: 'owner' } }),
        }),
      },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => ({ ...catalog, mode: 'disabled' }),
        fetchBillingStatus: async () => ({ mode: 'disabled', testOnly: true, canPurchase: false }),
        createTestPayment: async () => {
          creates++;
          return payment;
        },
      },
    },
    { sessionStorage: { getItem: () => null } },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox());
  render();
  await settle();
  await render().submit();
  assert.equal(render().enabled, false);
  assert.deepEqual(render().offers, []);
  assert.equal(creates, 0);
  harness.unmount();
});

test('server current payment resumes after storage loss without a new create request', async () => {
  const harness = hookHarness();
  let creates = 0;
  const routes = [];
  const load = moduleLoader(
    {
      react: harness.react,
      'next/navigation': { useRouter: () => ({ push: (path) => routes.push(path) }) },
      '@/stores/auth-store': {
        useAuthStore: Object.assign((select) => select({ user: { id: 'owner' } }), {
          getState: () => ({ user: { id: 'owner' } }),
        }),
      },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => catalog,
        fetchBillingStatus: async () => ({
          mode: 'test',
          testOnly: true,
          canPurchase: false,
          currentPaymentId: id,
        }),
        createTestPayment: async () => {
          creates++;
          return payment;
        },
      },
    },
    { sessionStorage: { getItem: () => null } },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox());
  render();
  await settle();
  assert.equal(render().recovering, true);
  assert.equal(render().available, true);
  await render().submit();
  assert.equal(creates, 0);
  assert.equal(routes[0], `/billing/return?paymentId=${id}`);
  harness.unmount();
});

test('period selection preserves the plan and shows only server offers from that period', async () => {
  const harness = hookHarness();
  const offers = ['month', 'season'].flatMap((period) =>
    ['light', 'core', 'heavy'].map((plan) => ({
      ...catalog.offers[0],
      id: `${plan}-${period}-v1`,
      plan,
      period,
    })),
  );
  const load = moduleLoader(
    {
      react: harness.react,
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/stores/auth-store': {
        useAuthStore: Object.assign((select) => select({ user: { id: 'owner' } }), {
          getState: () => ({ user: { id: 'owner' } }),
        }),
      },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => ({ ...catalog, offers }),
        fetchBillingStatus: async () => ({ mode: 'test', testOnly: true, canPurchase: true }),
      },
    },
    { sessionStorage: { getItem: () => null } },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox());
  render();
  await settle();
  assert.equal(render().selectedOffer.plan, 'core');
  assert.equal(render().period, 'season');
  assert.equal(render().periodOffers.length, 3);
  render().changePeriod('month');
  assert.equal(render().selectedOffer.plan, 'core');
  assert.equal(render().period, 'month');
  assert.ok(render().periodOffers.every((offer) => offer.period === 'month'));
  render().expand();
  assert.equal(render().expanded, true);
  render().changePeriod('season');
  assert.equal(render().expanded, true);
  harness.unmount();
});

test('return renders immutable offer details for pending, canceled, success and manual review', () => {
  const snapshot = {
    ...payment.offer,
    amount: { value: '123.45', currency: 'RUB' },
    checkLimit: 47,
    durationDays: 19,
  };
  for (const status of [
    'pending',
    'canceled',
    'succeeded',
    'waiting_for_capture',
    'review_required',
  ]) {
    const result = {
      payment: {
        ...payment,
        offer: snapshot,
        amount: snapshot.amount,
        status,
        entitlementApplied: status === 'succeeded',
        confirmationUrl: 'https://yoomoney.ru/checkout/test',
      },
      access: { mode: 'test', testOnly: true, canPurchase: true },
      error: null,
      checking: false,
      exhausted: false,
      retry: () => {},
    };
    const load = moduleLoader({
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/hooks/use-billing-payment': { useBillingPayment: () => result },
    });
    const markup = renderToStaticMarkup(
      createElement(load('@/components/billing/BillingReturn').BillingReturn, { paymentId: id }),
    );
    assert.match(markup, /Базовый минимум/);
    assert.match(markup, /123,45/);
    assert.match(markup, /47 проверок решений/);
    assert.match(markup, /19 суток/);
    assert.equal(markup.includes('Вернуться к оплате'), status === 'pending');
    assert.equal(markup.includes('Выбрать пакет снова'), status === 'canceled');
    assert.match(markup, /К подготовке/);
    assert.ok(markup.indexOf('</main>') < markup.indexOf('<footer'));
    assert.ok(
      markup.indexOf('<footer') < markup.indexOf('Проверить снова') ||
        !markup.includes('Проверить снова'),
    );
    assert.doesNotMatch(markup, /статус на сервере|Автоматическая проверка завершена/);
  }
});
