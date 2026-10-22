import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleLoader } from './helpers/hook-harness.mjs';

const { heartGraphPoints } = moduleLoader()('@/lib/heart-graph');

test('heart contour satisfies the requested implicit equation and includes both tips', () => {
  const points = heartGraphPoints();
  for (const { x, y } of points) {
    assert.ok(Math.abs((x * x + y * y - 1) ** 3 - x * x * y ** 3) < 1e-10);
  }
  assert.ok(points.some(({ x, y }) => Math.abs(x) < 1e-12 && Math.abs(y - 1) < 1e-10));
  assert.ok(points.some(({ x, y }) => Math.abs(x) < 1e-12 && Math.abs(y + 1) < 1e-10));
  assert.ok(Math.max(...points.map(({ y }) => y)) > 1.2);
});
