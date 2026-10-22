import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { expertTaskNavigationItems } = await import('@/lib/expert-task-navigation');
const { EXPERT_COPY } = await import('@/config/expert');

function task(score, maxScore, approved = true, analysis = {}) {
  return { id: String(score), approved, analysis: { score, maxScore, ...analysis } };
}

test('only confirmed grades color task navigation, including zero and partial credit', () => {
  const items = expertTaskNavigationItems([
    task(0, 3),
    task(2, 3),
    task(3, 3),
    task(0, 3, false),
    task(3, 3, false),
  ]);
  assert.deepEqual(
    items.map((item) => item.status),
    ['incorrect', 'partial', 'correct', 'unverified', 'unverified'],
  );
  assert.deepEqual(
    items.map((item) => item.score),
    ['0/3', '2/3', '3/3', null, null],
  );
  assert.equal(items[0].ariaLabel, `Задача 1 из 5, ${EXPERT_COPY.approvedTask}, 0 из 3 баллов`);
  assert.match(items[3].ariaLabel, /Ждёт проверки/);
  assert.doesNotMatch(items[3].ariaLabel, /баллов/);
});

test('missing, stale or invalid grades remain neutral instead of looking like a zero', () => {
  const items = expertTaskNavigationItems([
    task(0, 0),
    task(-1, 3),
    task(4, 3),
    task(NaN, 3),
    task(3, 3, true, { hasGrade: false }),
    task(3, 3, true, { gradeStale: true }),
  ]);
  assert.ok(items.every((item) => item.status === 'unverified' && item.score === null));
});
