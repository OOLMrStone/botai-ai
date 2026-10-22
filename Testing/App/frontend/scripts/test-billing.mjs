import './register-typescript.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { BILLING } = await import('@/config/billing');
const { ROUTES } = await import('@/config/onboarding-steps');
const { billingReturnPath, confirmationUrl, hasTestAccess, safeBillingReturn, billingOfferTerm } =
  await import('@/lib/billing');
const { finishBillingIntent, readBillingIntent, submitBillingIntent } =
  await import('@/lib/billing-intent');
const {
  createTestPayment,
  createTestSubscription,
  cancelTestSubscription,
  fetchTestPayment,
  refreshTestPayment,
} = await import('@/lib/api/billing');

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

test('season displays the inclusive Moscow calendar day without changing provider expiry', () => {
  const offer = {
    ...payment.offer,
    period: 'season',
    durationDays: null,
    expiresAt: '2027-06-10T21:00:00Z',
  };
  assert.match(billingOfferTerm(offer), /10 июня 2027.*включительно/);
  assert.doesNotMatch(billingOfferTerm(offer), /11 июня|00:00/);
  assert.equal(offer.expiresAt, '2027-06-10T21:00:00Z');
});
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('network loss and reload replay the original persisted idempotency key', async () => {
  const tab = storage();
  const keys = [];
  const create = async (_offer, key) => {
    keys.push(key);
    assert.equal(readBillingIntent(tab, 'owner').key, key);
    if (keys.length === 1) throw new TypeError('Network lost after provider accepted payment');
    return payment;
  };
  await assert.rejects(submitBillingIntent(tab, 'owner', payment.offerId, create));
  assert.equal(readBillingIntent(tab, 'owner').paymentId, undefined);
  await submitBillingIntent(tab, 'owner', payment.offerId, create);
  assert.equal(keys[0], keys[1]);
  assert.equal(readBillingIntent(tab, 'owner').paymentId, id);
});

test('unknown attempt cannot change offer, and another account cannot resume it', async () => {
  const tab = storage();
  await assert.rejects(
    submitBillingIntent(tab, 'owner', payment.offerId, async () => {
      throw new Error('Timeout');
    }),
  );
  let called = false;
  await assert.rejects(
    submitBillingIntent(tab, 'owner', 'heavy-month-v1', async () => {
      called = true;
      return payment;
    }),
  );
  assert.equal(called, false);
  assert.equal(readBillingIntent(tab, 'other-owner'), null);
});

test('pending never releases the intent; confirmed cancellation permits a new key', async () => {
  const tab = storage();
  await submitBillingIntent(tab, 'owner', payment.offerId, async () => payment);
  const firstKey = readBillingIntent(tab, 'owner').key;
  finishBillingIntent(tab, 'owner', payment);
  assert.equal(readBillingIntent(tab, 'owner').key, firstKey);
  finishBillingIntent(tab, 'owner', {
    ...payment,
    id: 'ab509c5f-c7e7-48b8-8951-cf069b66e7fa',
    status: 'canceled',
  });
  assert.equal(readBillingIntent(tab, 'owner').key, firstKey);
  finishBillingIntent(tab, 'owner', { ...payment, status: 'canceled' });
  assert.equal(readBillingIntent(tab, 'owner'), null);
  await submitBillingIntent(tab, 'owner', payment.offerId, async () => payment);
  assert.notEqual(readBillingIntent(tab, 'owner').key, firstKey);
});

test('storage failure prevents the create request and live response never grants test access', async () => {
  let called = false;
  const broken = {
    ...storage(),
    setItem: () => {
      throw new Error('Storage disabled');
    },
  };
  await assert.rejects(
    submitBillingIntent(broken, 'owner', payment.offerId, async () => {
      called = true;
      return payment;
    }),
  );
  assert.equal(called, false);
  await assert.rejects(
    submitBillingIntent(storage(), 'owner', payment.offerId, async () => ({
      ...payment,
      test: false,
    })),
  );
  assert.equal(hasTestAccess({ ...payment, status: 'succeeded' }), false);
  assert.equal(
    hasTestAccess({ ...payment, status: 'succeeded', entitlementApplied: true, test: false }),
    false,
  );
  assert.equal(hasTestAccess({ ...payment, status: 'succeeded', entitlementApplied: true }), true);
});

test('external redirect rejects untrusted hosts, credentials and non-HTTPS schemes', () => {
  assert.equal(
    confirmationUrl('https://yoomoney.ru/checkout/payments/v2/contract?orderId=test'),
    'https://yoomoney.ru/checkout/payments/v2/contract?orderId=test',
  );
  for (const url of [
    'javascript:alert(1)',
    'http://yoomoney.ru/pay',
    'https://yoomoney.ru.evil.test/pay',
    'https://evil.test/yookassa.ru',
    'https://u:p@yoomoney.ru/pay',
    'https://yoomoney.ru:8080/pay',
    '//yoomoney.ru/pay',
  ])
    assert.equal(confirmationUrl(url), null);
});

test('auth return only accepts the sandbox or an opaque payment id and drops injected parameters', () => {
  assert.equal(safeBillingReturn(ROUTES.billingSandbox), ROUTES.billingSandbox);
  assert.equal(
    safeBillingReturn(`${billingReturnPath(id)}&success=true&next=https://evil.test`),
    billingReturnPath(id),
  );
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/billing/return?paymentId=../../admin',
    '/billing/sandbox/../admin',
    '/home',
    '/billing/return?success=true',
  ])
    assert.equal(safeBillingReturn(path), null);
});

test('billing boundary sends only offer id plus idempotency and CSRF headers; refresh is POST', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_path, init) => {
    assert.equal(init.credentials, 'include');
    return Response.json(payment);
  });
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'XSRF-TOKEN=test-xsrf' },
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  await createTestPayment(payment.offerId, id);
  await fetchTestPayment(id);
  await refreshTestPayment(id);
  const consent = { accepted: true, version: 'test-recurring-v1' };
  await createTestSubscription('core-month-subscription-v1', id, consent);
  await cancelTestSubscription(id);
  const calls = globalThis.fetch.mock.calls;
  assert.equal(calls[0].arguments[0], BILLING.paymentsPath);
  assert.deepEqual(JSON.parse(calls[0].arguments[1].body), { offerId: payment.offerId });
  assert.equal(calls[0].arguments[1].headers.get('Idempotency-Key'), id);
  assert.equal(calls[0].arguments[1].headers.get('X-XSRF-TOKEN'), 'test-xsrf');
  assert.equal(calls[1].arguments[1].method, 'GET');
  assert.equal(calls[2].arguments[1].method, 'POST');
  assert.equal(calls[2].arguments[0], `${BILLING.paymentsPath}/${id}/refresh`);
  assert.equal(calls[3].arguments[0], BILLING.subscriptionsPath);
  assert.deepEqual(JSON.parse(calls[3].arguments[1].body), {
    offerId: 'core-month-subscription-v1',
    consent,
  });
  assert.equal(calls[3].arguments[1].headers.get('Idempotency-Key'), id);
  assert.equal(calls[3].arguments[1].headers.get('X-XSRF-TOKEN'), 'test-xsrf');
  assert.equal(calls[4].arguments[0], `${BILLING.subscriptionsPath}/${id}/cancel`);
  assert.equal(calls[4].arguments[1].method, 'POST');
  assert.equal(calls[4].arguments[1].headers.get('X-XSRF-TOKEN'), 'test-xsrf');
});
