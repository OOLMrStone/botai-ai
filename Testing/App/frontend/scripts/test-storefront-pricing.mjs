import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

test('season equivalent never replaces the full payment amount or the package quota', () => {
  const harness = hookHarness();
  const load = moduleLoader({ react: harness.react });
  const { useStorefrontPricing } = load('@/hooks/use-storefront-pricing');
  let pricing = harness.render(useStorefrontPricing);
  assert.deepEqual(
    pricing.plans.map((plan) => plan.price.replace(/\s/g, '')),
    ['299₽', '699₽', '899₽'],
  );
  assert.deepEqual(
    pricing.plans.map((plan) => plan.quota),
    [30, 70, 110],
  );
  pricing.setPeriod('season');
  pricing = harness.render(useStorefrontPricing);
  assert.deepEqual(
    pricing.plans.map((plan) => plan.season),
    [1499, 3499, 4999],
  );
  assert.deepEqual(
    pricing.plans.map((plan) => plan.quota),
    [240, 560, 880],
  );
  assert.deepEqual(
    pricing.plans.map((plan) => plan.price.replace(/\s/g, '')),
    ['187,4₽', '437,4₽', '624,9₽'],
  );
  assert.deepEqual(
    pricing.plans.map((plan) => plan.payment.replace(/\s/g, '')),
    [
      '1499₽запакет,оплачиваетсяцеликом',
      '3499₽запакет,оплачиваетсяцеликом',
      '4999₽запакет,оплачиваетсяцеликом',
    ],
  );
});
