import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}

test('season uses full payment and an immediately available package without monthly equivalents', () => {
  const load = moduleLoader();
  const { PAYWALL_PLANS } = load('@/config/paywall');
  const { paywallPrice } = load('@/lib/paywall');
  assert.deepEqual(
    PAYWALL_PLANS.map((plan) => paywallPrice(plan, 'season')),
    [
      { total: '1\u00a0499', checks: 240 },
      { total: '3\u00a0499', checks: 560 },
      { total: '4\u00a0999', checks: 880 },
    ],
  );
  assert.deepEqual(
    PAYWALL_PLANS.map((plan) => paywallPrice(plan, 'month').total),
    ['299', '699', '899'],
  );
  assert.deepEqual(
    PAYWALL_PLANS.map((plan) => paywallPrice(plan, 'month').checks),
    [30, 70, 110],
  );
});

test('other plans stay revealed and ordered after selection and period changes; checkout never grants access', () => {
  const harness = hookHarness();
  const load = moduleLoader(
    { react: { ...harness.react, useLayoutEffect: harness.react.useEffect } },
    {
      window: { matchMedia: () => ({ matches: true }) },
    },
  );
  const { usePaywallSelection } = load('@/hooks/use-paywall-selection');
  const render = () => harness.render(usePaywallSelection);
  let state = render();
  assert.equal(state.period, 'season');
  assert.equal(state.selectedId, 'core');
  assert.deepEqual(
    state.plans.map((plan) => plan.id),
    ['core'],
  );
  state.expand();
  state = render();
  assert.equal(state.chosen, false);
  assert.deepEqual(
    state.plans.map((plan) => plan.id),
    ['light', 'core', 'heavy'],
  );
  state.select('heavy');
  state = render();
  state.changePeriod('month');
  state = render();
  assert.equal(state.chosen, true);
  assert.equal(state.period, 'month');
  assert.equal(state.selectedId, 'heavy');
  assert.deepEqual(
    state.plans.map((plan) => plan.id),
    ['light', 'core', 'heavy'],
  );
  state.continue();
  state = render();
  assert.equal(state.checkoutUnavailable, true);
  assert.equal(state.selectedId, 'heavy');
  state.changePeriod('season');
  state = render();
  assert.equal(state.checkoutUnavailable, false);
  harness.unmount();
});

test('period controls expose exactly the visible selection and deliver the selected period', () => {
  const calls = [];
  const load = moduleLoader({
    '@/hooks/use-paywall-selection': {
      usePaywallSelection: () => ({
        period: 'season',
        selectedId: 'core',
        expanded: false,
        chosen: false,
        checkoutUnavailable: false,
        plans: [],
        changePeriod: (period) => calls.push(period),
      }),
    },
  });
  const { PaywallScreen } = load('@/components/paywall/PaywallScreen');
  const { BillingPeriodSwitch } = load('@/components/common/BillingPeriodSwitch');
  const control = elements(PaywallScreen({ entry: 'photo', attach() {}, onClose() {} })).find(
    (node) => node.type === BillingPeriodSwitch,
  );
  assert.ok(control);
  const periods = elements(BillingPeriodSwitch(control.props)).filter(
    (node) => node.type === 'button' && typeof node.props['aria-pressed'] === 'boolean',
  );
  assert.deepEqual(
    periods.map((node) => [node.props.children, node.props['aria-pressed']]),
    [
      ['Месяц', false],
      ['Сезон', true],
    ],
  );
  periods[0].props.onClick();
  assert.deepEqual(calls, ['month']);
});

test('photo access gate opens before any file picker; paid access retains the same picker', () => {
  const harness = hookHarness();
  const load = moduleLoader({
    react: harness.react,
    '@/components/ui/button': { Button: 'button' },
  });
  const { FileUploadButton } = load('@/components/common/FileUploadButton');
  let requested = 0;
  let picker = 0;
  let gated = true;
  const render = () =>
    harness.render(() =>
      FileUploadButton({
        onAdd() {},
        label: 'Фото',
        accept: 'image/*',
        onRequestAccess: gated ? () => requested++ : undefined,
      }),
    );
  let nodes = elements(render());
  nodes.find((node) => node.type === 'input').props.ref.current = { click: () => picker++ };
  nodes.find((node) => node.type === 'button').props.onClick();
  assert.equal(requested, 1);
  assert.equal(picker, 0);
  gated = false;
  nodes = elements(render());
  nodes.find((node) => node.type === 'button').props.onClick();
  assert.equal(requested, 1);
  assert.equal(picker, 1);
});

test('opening starts the existing video synchronously and closing preserves its instance', () => {
  const harness = hookHarness();
  const load = moduleLoader({ react: { ...harness.react, createContext: () => ({}) } });
  const { usePaywallStage } = load('@/hooks/use-paywall');
  const render = () => harness.render(usePaywallStage);
  let state = render();
  const ref = state.playerRef;
  const entriesDuringStart = [];
  ref.current = { start: () => entriesDuringStart.push(render().entry) };
  state.context.open('photo');
  state = render();
  assert.deepEqual(entriesDuringStart, [null]);
  assert.equal(state.entry, 'photo');
  state.close();
  state = render();
  assert.equal(state.entry, null);
  state.context.open('profile');
  state = render();
  assert.equal(state.entry, 'profile');
  assert.equal(state.playerRef, ref);
  assert.equal(entriesDuringStart.length, 2);
});

test('monthly cards omit season equivalents and season cards explain the full check budget', () => {
  const load = moduleLoader();
  const { PaywallPlanCard } = load('@/components/paywall/PaywallPlanCard');
  const { PAYWALL_PLANS } = load('@/config/paywall');
  const text = (tree) =>
    elements(tree)
      .flatMap((node) => {
        const children = Array.isArray(node.props?.children)
          ? node.props.children
          : [node.props?.children];
        return children.filter((child) => typeof child === 'string');
      })
      .join(' ');
  const props = { plan: PAYWALL_PLANS[1], selected: true, chosen: false, onSelect() {} };
  const season = text(PaywallPlanCard({ ...props, period: 'season' }));
  assert.match(season, /560 проверок/);
  assert.match(season, /Весь пакет доступен сразу/);
  assert.doesNotMatch(season, /10 июня 2027|Без автопродления/);
  assert.match(season, /3\s499/);
  assert.doesNotMatch(season, /в месяц|437/);
  const monthly = text(PaywallPlanCard({ ...props, period: 'month' }));
  assert.match(monthly, /699/);
  assert.doesNotMatch(monthly, /Автопродление|не переносятся|Весь пакет/);
  assert.doesNotMatch(monthly, /560|8 месяцев|в день/);
});

test('daily package comparison uses inclusive Moscow calendar days and hides after expiry', () => {
  const load = moduleLoader();
  const { PAYWALL_PLANS } = load('@/config/paywall');
  const { paywallDailyPrice } = load('@/lib/paywall');
  const plan = PAYWALL_PLANS[1];
  assert.deepEqual(paywallDailyPrice(plan, new Date('2026-10-07T12:00:00Z')), {
    days: 247,
    amount: '14,17',
  });
  assert.deepEqual(paywallDailyPrice(plan, new Date('2027-06-09T21:00:00Z')), {
    days: 1,
    amount: '3\u00a0499,00',
  });
  assert.equal(paywallDailyPrice(plan, new Date('2027-06-10T21:00:00Z')), null);
});
