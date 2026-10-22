import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { moduleLoader } from './helpers/hook-harness.mjs';

const load = moduleLoader({ '@/config/env': { IS_MOCK_API: false } });
const { flowProgress } = load('@/lib/flow-progress');
const { REGISTER_STEPS, ONBOARDING_STEPS, registerPath, onboardingPath } = load(
  '@/config/onboarding-steps',
);

test('первый, отсутствующий и единственный шаг не показывают ложный прогресс', () => {
  for (const pathname of ['', '/', '/register/save-progress', registerPath(REGISTER_STEPS[0])]) {
    assert.equal(flowProgress(pathname, REGISTER_STEPS), null);
  }
  assert.equal(flowProgress('/single', ['single']), null);
  assert.equal(flowProgress('/empty', []), null);
  assert.equal(flowProgress('/onboarding/building', ONBOARDING_STEPS), null);
});

test('единая регистрация не показывает шкалу промежуточных шагов', () => {
  assert.deepEqual(REGISTER_STEPS, ['account']);
  assert.equal(flowProgress(registerPath('account'), REGISTER_STEPS), null);
  assert.equal(flowProgress(`${registerPath('account')}/`, REGISTER_STEPS), null);
  for (const legacy of ['age', 'name', 'email', 'password']) {
    assert.equal(flowProgress(`/register/${legacy}`, REGISTER_STEPS), null);
  }
});

test('онбординг делит прогресс на реальные переходы и не считает скрытые шаги', () => {
  const values = ONBOARDING_STEPS.slice(1).map((step) =>
    flowProgress(onboardingPath(step), ONBOARDING_STEPS),
  );
  assert.ok(values.length > 0);
  for (let index = 0; index < values.length; index++) {
    assert.equal(values[index].value, index + 1);
    assert.equal(values[index].max, values.length);
  }
  assert.equal(values.at(-1).value / values.at(-1).max, 1);
});

test('шапка сохраняет один Progress при движении вперёд и назад и вызывает реальный back', () => {
  let pathname = onboardingPath(ONBOARDING_STEPS[0]);
  let backCalls = 0;
  const loadHeader = moduleLoader({
    '@/config/env': { IS_MOCK_API: false },
    'next/navigation': {
      usePathname: () => pathname,
      useRouter: () => ({ back: () => backCalls++ }),
    },
  });
  const { OnboardingHeader } = loadHeader('@/components/onboarding/OnboardingHeader');
  const { Progress } = loadHeader('@/components/ui/progress');
  assert.equal(OnboardingHeader({ steps: ONBOARDING_STEPS }), null);

  const last = ONBOARDING_STEPS.length - 1;
  for (const index of [1, 2, 1, last]) {
    const step = ONBOARDING_STEPS[index];
    const expected = index / last;
    pathname = onboardingPath(step);
    const header = OnboardingHeader({ steps: ONBOARDING_STEPS });
    const progress = header.props.children.find((child) => child.type === Progress);
    assert.equal(progress.key, null);
    assert.equal(progress.props.value / progress.props.max, expected);
    const root = Progress(progress.props);
    const indicator = root.props.children[1].props.children;
    assert.equal(indicator.props.style.transform, `scaleX(${expected})`);
  }
  OnboardingHeader({ steps: ONBOARDING_STEPS }).props.children[0].props.onClick();
  assert.equal(backCalls, 1);

  pathname = onboardingPath(ONBOARDING_STEPS[0]);
  assert.equal(OnboardingHeader({ steps: ONBOARDING_STEPS }), null);
});

test('первое заполнение начинается от нуля только через transform и уважает reduced motion', () => {
  const { Progress } = load('@/components/ui/progress');
  const { MOTION_STYLES } = load('@/config/motion');
  const root = Progress({ value: 1, max: 3 });
  const indicator = root.props.children[1].props.children;
  assert.equal(root.props.value, 1);
  assert.equal(root.props.max, 3);
  assert.equal(indicator.props.style.transform, `scaleX(${1 / 3})`);
  assert.match(indicator.props.className, /transition-transform/);
  assert.match(indicator.props.className, /motion-reduce:transition-none/);
  assert.match(MOTION_STYLES.progressEnter, /^motion-safe:animate-/);
  assert.match(MOTION_STYLES.progressEnter, /var\(--progress-motion-duration\)/);
  assert.doesNotMatch(MOTION_STYLES.progressEnter, /infinite|forwards/);

  const css = readFileSync(resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
  const entry = css.match(/@keyframes flow-progress-enter\s*\{\s*from\s*\{([^}]+)\}\s*\}/);
  assert.ok(entry, 'Входная анимация должна иметь только начальный кадр, конечный даёт value');
  assert.match(entry[1], /transform:\s*scaleX\(0\)/);
  assert.deepEqual(
    [...entry[1].matchAll(/([\w-]+)\s*:/g)].map((match) => match[1]),
    ['transform'],
  );
});
