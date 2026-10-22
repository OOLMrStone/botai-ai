import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { moduleLoader, hookHarness, deferred, settle } from './helpers/hook-harness.mjs';

const id = 'bb509c5f-c7e7-48b8-8951-cf069b66e7fa';
const subscriptionId = 'a9509c5f-c7e7-48b8-8951-cf069b66e7fa';
const offer = {
  id: 'core-month-subscription-v1',
  kind: 'subscription',
  plan: 'core',
  period: 'month',
  amount: { value: '699.00', currency: 'RUB' },
  checkLimit: 70,
  durationDays: 30,
  intervalDays: 30,
  autoRenew: true,
  consentVersion: 'test-recurring-v1',
};
const season = {
  ...offer,
  id: 'core-season-v1',
  kind: 'one_time',
  period: 'season',
  autoRenew: false,
  durationDays: null,
  intervalDays: null,
  consentVersion: null,
  expiresAt: '2027-06-10T21:00:00Z',
};
const payment = {
  id,
  offerId: offer.id,
  offer,
  amount: offer.amount,
  status: 'creating',
  test: true,
  entitlementApplied: false,
  createdAt: '2026-10-08T10:00:00Z',
  purpose: 'subscription_initial',
  subscriptionId,
};
const entitlement = {
  plan: 'core',
  startsAt: '2026-10-08T10:00:00Z',
  expiresAt: '2026-11-07T10:00:00Z',
  checksTotal: 70,
  checksUsed: 3,
  checksReserved: 2,
  checksRemaining: 65,
};
const subscription = {
  id: subscriptionId,
  status: 'active',
  renewalEnabled: true,
  offer,
  currentPeriod: { ...entitlement, sequence: 1 },
  paidThrough: entitlement.expiresAt,
  nextPaymentAt: entitlement.expiresAt,
};
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const auth = Object.assign((select) => select({ user: { id: 'owner' } }), {
  getState: () => ({ user: { id: 'owner' } }),
});
function checkout({ storage = memoryStorage(), create, status, offers = [offer, season] } = {}) {
  const harness = hookHarness();
  const calls = [];
  const routes = [];
  const load = moduleLoader(
    {
      react: harness.react,
      'next/navigation': { useRouter: () => ({ push: (path) => routes.push(path) }) },
      '@/stores/auth-store': { useAuthStore: auth },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => ({ mode: 'test', testOnly: true, offers }),
        fetchBillingStatus: async () =>
          typeof status === 'function'
            ? status()
            : (status ?? { mode: 'test', testOnly: true, canPurchase: true }),
        createTestSubscription: async (...args) => {
          calls.push(args);
          return create ? create(...args) : { subscription, payment };
        },
        createTestPayment: async () => assert.fail('Subscription must not use one-off endpoint'),
      },
    },
    {
      sessionStorage: storage,
      window: { location: { assign: () => assert.fail('No redirect in fixture') } },
    },
  );
  return {
    render: () => harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox()),
    unmount: harness.unmount,
    calls,
    routes,
  };
}

test('leaving checkout ignores a late result but preserves its id for safe resume', async () => {
  const response = deferred();
  const storage = memoryStorage();
  const first = checkout({ storage, create: () => response.promise });
  first.render();
  await settle();
  first.render().changePeriod('month');
  first.render().acceptConsent(true);
  const request = first.render().submit();
  first.unmount();
  response.resolve({ subscription, payment });
  await request;
  assert.equal(first.routes.length, 0);
  const next = checkout({ storage });
  next.render();
  await settle();
  assert.equal(next.render().resumePaymentId, id);
  await next.render().submit();
  assert.equal(next.calls.length, 0);
  assert.deepEqual(next.routes, [`/billing/return?paymentId=${id}`]);
  next.unmount();
});

test('monthly consent starts unchecked, blocks creation, and resets on each different offer', async () => {
  const state = checkout({
    offers: [offer, season, { ...offer, id: 'heavy-month-subscription-v1', plan: 'heavy' }],
  });
  state.render();
  await settle();
  state.render().changePeriod('month');
  assert.equal(state.render().consentAccepted, false);
  assert.equal(state.render().canSubmit, false);
  const markup = () => {
    const load = moduleLoader({
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/hooks/use-billing-sandbox': { useBillingSandbox: () => state.render() },
    });
    return renderToStaticMarkup(
      createElement(load('@/components/billing/BillingSandbox').BillingSandbox),
    );
  };
  const uncheckedMarkup = markup();
  const prompt = 'Чтобы подключить подписку, подтверди согласие';
  assert.ok(uncheckedMarkup.indexOf(prompt) > uncheckedMarkup.indexOf('<footer'));
  assert.match(uncheckedMarkup, /aria-controls="billing-recurring-consent"/);
  assert.match(uncheckedMarkup, /disabled=""[^>]*>Подключить подписку/);
  const focusActions = [];
  const checkbox = {
    checked: false,
    scrollIntoView: (options) => focusActions.push(['scroll', options]),
    focus: (options) => focusActions.push(['focus', options]),
  };
  state.render().consentRef.current = checkbox;
  state.render().focusConsent();
  assert.deepEqual(focusActions, [
    ['scroll', { block: 'center', behavior: 'instant' }],
    ['focus', { preventScroll: true }],
  ]);
  assert.equal(checkbox.checked, false);
  assert.equal(state.render().consentAccepted, false);
  assert.equal(state.render().canSubmit, false);
  await state.render().submit();
  assert.equal(state.calls.length, 0);
  state.render().acceptConsent(true);
  assert.equal(state.render().canSubmit, true);
  assert.equal(markup().includes(prompt), false);
  state.render().select('heavy-month-subscription-v1');
  assert.equal(state.render().consentAccepted, false);
  state.render().acceptConsent(true);
  state.render().changePeriod('season');
  assert.equal(state.render().consentNeeded, false);
  state.render().changePeriod('month');
  assert.equal(state.render().consentAccepted, false);
  state.render().acceptConsent(true);
  await state.render().submit();
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0][2], { accepted: true, version: offer.consentVersion });
  state.unmount();
});

test('unknown subscription creation survives reload with original consent and key even after catalogue change', async () => {
  const storage = memoryStorage();
  const first = checkout({
    storage,
    create: async () => {
      throw new TypeError('Lost response');
    },
  });
  first.render();
  await settle();
  first.render().changePeriod('month');
  first.render().acceptConsent(true);
  await first.render().submit();
  assert.equal(first.render().recovering, true);
  const original = first.calls[0];
  first.unmount();
  const next = checkout({
    storage,
    offers: [
      { ...offer, consentVersion: 'new-version', amount: { value: '999.00', currency: 'RUB' } },
    ],
  });
  next.render();
  await settle();
  assert.equal(next.render().selectedOffer.amount.value, '699.00');
  assert.equal(next.render().consentAccepted, false);
  assert.equal(next.render().canSubmit, true);
  await next.render().submit();
  assert.deepEqual(next.calls[0], original);
  next.unmount();
});

test('definitive consent rejection clears only the rejected intent and requires a new unchecked choice', async () => {
  const ApiError = moduleLoader()('@/lib/api/client').ApiError;
  // Share the class identity with the hook's module cache.
  const harness = hookHarness();
  const storage = memoryStorage();
  let calls = 0;
  const load = moduleLoader(
    {
      react: harness.react,
      '@/lib/api/client': { ApiError },
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/stores/auth-store': { useAuthStore: auth },
      '@/lib/api/billing': {
        fetchBillingOffers: async () => ({ mode: 'test', testOnly: true, offers: [offer] }),
        fetchBillingStatus: async () => ({ mode: 'test', testOnly: true, canPurchase: true }),
        createTestSubscription: async () => {
          calls++;
          throw new ApiError(409, 'Changed', 'recurring_consent_changed');
        },
      },
    },
    { sessionStorage: storage },
  );
  const render = () =>
    harness.render(() => load('@/hooks/use-billing-sandbox').useBillingSandbox());
  render();
  await settle();
  render().acceptConsent(true);
  await render().submit();
  assert.equal(render().intent, null);
  assert.equal(render().consentAccepted, false);
  assert.equal(render().canSubmit, false);
  await render().submit();
  assert.equal(calls, 1);
  harness.unmount();
});

test('active product cannot create an overlapping subscription', async () => {
  const state = checkout({
    status: { mode: 'test', testOnly: true, canPurchase: false, subscription, entitlement },
  });
  state.render();
  await settle();
  state.render().acceptConsent(true);
  await state.render().submit();
  assert.equal(state.calls.length, 0);
  assert.equal(state.render().available, false);
  state.unmount();
});

test('management refresh failure stays visible with paid access intact and retries only reads', async () => {
  let fail = false;
  let reads = 0;
  const status = { mode: 'test', testOnly: true, canPurchase: false, subscription, entitlement };
  const state = checkout({
    status: () => {
      reads++;
      if (fail) throw new TypeError('Network unavailable after unknown cancel');
      return status;
    },
  });
  const markup = () => {
    const load = moduleLoader({
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/hooks/use-billing-sandbox': { useBillingSandbox: () => state.render() },
    });
    return renderToStaticMarkup(
      createElement(load('@/components/billing/BillingSandbox').BillingSandbox),
    );
  };
  state.render();
  await settle();
  assert.equal(state.render().available, false);
  fail = true;
  state.render().retry();
  state.render();
  await settle();
  assert.equal(state.render().status, status);
  assert.match(markup(), /role="alert"/);
  assert.match(markup(), /Не удалось обновить статус/);
  assert.match(markup(), /Осталось 65 из 70/);
  assert.match(markup(), /Повторить/);
  assert.equal(state.render().status.subscription.renewalEnabled, true);
  fail = false;
  state.render().retry();
  state.render();
  await settle();
  assert.equal(state.render().error, null);
  assert.equal(markup().includes('Не удалось обновить статус'), false);
  assert.equal(reads, 3);
  assert.equal(state.calls.length, 0);
  state.unmount();
});

test('cancel is server-confirmed, blocks double submit, keeps paidThrough and exposes in-flight payment', async () => {
  const harness = hookHarness();
  const response = deferred();
  const changed = [];
  let calls = 0;
  const load = moduleLoader({
    react: harness.react,
    '@/stores/auth-store': { useAuthStore: auth },
    '@/lib/api/billing': {
      cancelTestSubscription: async () => {
        calls++;
        return response.promise;
      },
    },
  });
  const render = () =>
    harness.render(() =>
      load('@/hooks/use-billing-subscription').useBillingSubscription(subscription, (value) =>
        changed.push(value),
      ),
    );
  render().changeOpen(true);
  const pending = render().cancel();
  await render().cancel();
  assert.equal(calls, 1);
  assert.equal(changed.length, 0);
  response.resolve({
    ...subscription,
    renewalEnabled: false,
    status: 'canceled',
    nextPaymentAt: null,
    inFlightPaymentId: id,
  });
  await pending;
  assert.equal(changed[0].paidThrough, entitlement.expiresAt);
  assert.equal(changed[0].inFlightPaymentId, id);
  assert.equal(changed[0].renewalEnabled, false);
  assert.equal(render().open, false);
  harness.unmount();
});

test('cancel timeout preserves confirmed subscription, and initial pending consent can be revoked', async () => {
  const harness = hookHarness();
  let changed = 0;
  let calls = 0;
  const load = moduleLoader({
    react: harness.react,
    '@/stores/auth-store': { useAuthStore: auth },
    '@/lib/api/billing': {
      cancelTestSubscription: async () => {
        calls++;
        throw new TypeError('Timeout');
      },
    },
  });
  const pending = {
    ...subscription,
    renewalEnabled: false,
    status: 'pending_initial',
    nextPaymentAt: null,
  };
  const render = () =>
    harness.render(() =>
      load('@/hooks/use-billing-subscription').useBillingSubscription(pending, () => changed++),
    );
  assert.equal(render().canCancel, true);
  render().changeOpen(true);
  await render().cancel();
  assert.equal(calls, 1);
  assert.equal(changed, 0);
  assert.equal(render().open, true);
  assert.match(render().error, /Не удалось подтвердить/);
  harness.unmount();
});

test('profile billing entry fails closed on missing, disabled, live and failed status, and account switch', async () => {
  for (const response of [
    null,
    {},
    { mode: 'test' },
    { mode: 'live', testOnly: true },
    { mode: 'disabled', testOnly: true },
    new Error('Offline'),
    { mode: 'test', testOnly: true },
  ]) {
    const harness = hookHarness();
    let owner = 'owner';
    const load = moduleLoader({
      react: harness.react,
      '@/stores/auth-store': { useAuthStore: (select) => select({ user: { id: owner } }) },
      '@/lib/api/billing': {
        fetchBillingStatus: async () => {
          if (response instanceof Error) throw response;
          return response;
        },
      },
    });
    const render = () =>
      harness.render(() => load('@/hooks/use-billing-capability').useBillingCapability());
    assert.equal(Boolean(render()), false);
    await settle();
    assert.equal(Boolean(render()), response?.mode === 'test' && response?.testOnly === true);
    owner = 'other-owner';
    assert.equal(Boolean(render()), false);
    harness.unmount();
  }
});

test('profile uses one capability result and replaces the legacy Free card only for test mode', () => {
  for (const enabled of [false, true]) {
    let capabilityReads = 0;
    const load = moduleLoader({
      '@/hooks/use-billing-capability': {
        useBillingCapability: () => {
          capabilityReads++;
          return enabled;
        },
      },
      '@/hooks/use-profile': {
        useProfile: () => ({
          data: { displayName: 'Тестер', registeredAt: '2026-10-08T10:00:00Z' },
        }),
      },
      '@/hooks/use-user-stats': {
        useUserStats: () => ({ stats: null, failed: false, retry: () => {} }),
      },
      '@/stores/auth-store': {
        useAuthStore: (select) =>
          select({ user: { id: 'owner', displayName: 'Тестер', role: 'USER' } }),
      },
      '@/stores/profile-store': { useProfileStore: (select) => select({ name: null }) },
      '@/hooks/use-plan': { usePlan: () => ({ label: 'Бесплатный' }) },
      '@/hooks/use-paywall': { usePaywall: () => ({ open: () => {} }) },
    });
    const html = renderToStaticMarkup(
      createElement(load('@/app/(learning)/(app)/profile/page').default),
    );
    assert.equal(capabilityReads, 1);
    assert.equal(html.includes('Бесплатный'), !enabled);
    assert.equal(html.includes('href="/billing/sandbox"'), enabled);
    assert.equal(html.includes('Тестовый режим'), enabled);
  }
});

test('saved=false remains success with paid quota; decline shows no auto retry and no purchase while blocked', () => {
  for (const scenario of ['saved-false', 'renewal-declined', 'auto-on']) {
    const sub = {
      ...subscription,
      renewalEnabled: scenario === 'auto-on',
      nextPaymentAt: scenario === 'auto-on' ? '2026-11-08T15:17:00Z' : null,
      status: scenario === 'renewal-declined' ? 'payment_failed' : 'active',
      actionRequired: scenario === 'saved-false' ? 'payment_method_required' : null,
    };
    const result = {
      payment: {
        ...payment,
        status: scenario === 'renewal-declined' ? 'canceled' : 'succeeded',
        entitlementApplied: scenario !== 'renewal-declined',
        purpose: scenario === 'renewal-declined' ? 'subscription_renewal' : 'subscription_initial',
      },
      access: { mode: 'test', testOnly: true, canPurchase: false, entitlement, subscription: sub },
      error: null,
      checking: false,
      exhausted: false,
      retry: () => {},
      updateSubscription: () => {},
    };
    const load = moduleLoader({
      'next/navigation': { useRouter: () => ({ push: () => {} }) },
      '@/hooks/use-billing-payment': { useBillingPayment: () => result },
    });
    const html = renderToStaticMarkup(
      createElement(load('@/components/billing/BillingReturn').BillingReturn, { paymentId: id }),
    );
    assert.match(html, /Осталось 65 из 70/);
    assert.match(html, /На проверке сейчас: 2/);
    assert.match(html, /7 ноября 2026/);
    assert.doesNotMatch(html, /Выбрать пакет снова/);
    assert.match(html, /Управлять тарифом/);
    assert.doesNotMatch(html, /Затем/);
    if (scenario === 'saved-false') {
      assert.match(html, /оплата прошла/);
      assert.match(html, /Автопродление не подключено/);
    }
    if (scenario === 'renewal-declined') {
      assert.match(html, /Не удалось продлить/);
      assert.match(html, /Повторного автоматического списания по этой попытке не будет/);
    }
    assert.equal(html.includes('Следующее списание'), scenario === 'auto-on');
    if (scenario === 'auto-on') assert.match(html, /8 ноября 2026.*18:17/);
  }
});

test('native consent is unchecked and season has no recurring checkbox', () => {
  const Component = moduleLoader()('@/components/billing/BillingConsent').BillingConsent;
  const html = renderToStaticMarkup(
    createElement(Component, { offer, accepted: false, disabled: false, onChange: () => {} }),
  );
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /checked=/);
  assert.match(html, /каждые 30 суток/);
  assert.match(html, /«Твой тариф»/);
  assert.equal(
    renderToStaticMarkup(
      createElement(Component, {
        offer: season,
        accepted: false,
        disabled: false,
        onChange: () => {},
      }),
    ),
    '',
  );
});
