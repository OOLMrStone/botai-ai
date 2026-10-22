import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

const {
  updateNativePoint,
  setNativePointBoundary,
  addNativePoint,
  removeNativePoint,
  updateNativeArc,
  setNativeArcDirection,
  removeNativeArc,
  addNativeArc,
  nativeEndpointOptions,
} = await import('@/lib/expert-native-editor');
const { validateExpertDiagram } = await import('@/lib/expert');
const { EXPERT_NATIVE_EDITOR: CONFIG } = await import('@/config/expert-native-editor');

const point = (id, value, patch = {}) => ({ id, value, included: false, sign: null, ...patch });
const arc = (from, to, patch = {}) => ({ from, to, selected: false, sign: null, ...patch });
const line = () => ({
  kind: 'number_line_v2',
  variable: 't',
  note: 'При $t > 0$',
  points: [point('a', 'z'), point('b', '\\frac{2}{4}'), point('c', '0.5')],
  arcs: [arc('-inf', 'a'), arc('b', 'b', { sign: '0' }), arc('c', '+inf', { selected: true })],
});
const circle = () => ({
  kind: 'unit_circle_v2',
  points: [point('a', '\\theta'), point('b', '\\frac{\\pi}{2}')],
  arcs: [arc('a', 'b', { direction: 'cw', full_circle: false })],
});

test('point edit preserves exact text, point order and sparse references', () => {
  const before = line();
  const next = updateNativePoint(before, 'b', { value: '  \\frac{1}{2}  ' });
  assert.deepEqual(
    next.points.map(({ id }) => id),
    ['a', 'b', 'c'],
  );
  assert.equal(next.points[1].value, '  \\frac{1}{2}  ');
  assert.deepEqual(next.arcs, before.arcs);
  assert.equal(before.points[1].value, '\\frac{2}{4}');
  assert.equal(next.variable, before.variable);
  assert.equal(next.note, before.note);
  assert.equal(validateExpertDiagram(next), null);
});

test('point removal only removes arcs referencing that exact id', () => {
  const before = line();
  before.points[1].value = before.points[2].value;
  const next = removeNativePoint(before, 'b');
  assert.deepEqual(
    next.points.map(({ id }) => id),
    ['a', 'c'],
  );
  assert.deepEqual(next.arcs, [before.arcs[0], before.arcs[2]]);
  assert.equal(validateExpertDiagram(next), null);
});

test('boundary removal explicitly resolves null inclusion without changing sign', () => {
  const before = line();
  before.points[0] = point('a', '0', { included: null, bound: true, sign: '0' });
  const next = setNativePointBoundary(before, 'a', false);
  assert.deepEqual(next.points[0], point('a', '0', { bound: false, sign: '0' }));
  assert.equal(before.points[0].included, null);
  assert.equal(updateNativePoint(before, 'a', { sign: null }).points[0].included, null);
  assert.equal(setNativePointBoundary(line(), 'a', true).points[0].included, false);
});

test('line loops remain legal and null sign stays distinct from zero', () => {
  const before = line();
  const loop = updateNativeArc(before, 0, { from: 'c', to: 'c', sign: '0' });
  assert.equal(validateExpertDiagram(loop), null);
  assert.equal(loop.arcs[0].sign, '0');
  assert.equal(updateNativeArc(loop, 0, { sign: null }).arcs[0].sign, null);
  assert.equal(loop.arcs.length, before.arcs.length);
});

test('circle full_circle follows endpoint IDs, independent of equal angle labels', () => {
  const before = circle();
  before.points[0].value = before.points[1].value;
  const full = updateNativeArc(before, 0, { to: 'a' });
  assert.equal(full.arcs[0].full_circle, true);
  assert.equal(full.arcs[0].direction, 'cw');
  const partial = updateNativeArc(full, 0, { to: 'b' });
  assert.equal(partial.arcs[0].full_circle, false);
  assert.equal(validateExpertDiagram(partial), null);
  const reversed = setNativeArcDirection(partial, 0, 'ccw');
  assert.equal(reversed.arcs[0].direction, 'ccw');
  assert.equal(reversed.arcs[0].full_circle, false);
});

test('point and arc additions only happen explicitly and preserve all existing entries', () => {
  const before = line();
  const withPoint = addNativePoint(before, 'd');
  assert.deepEqual(withPoint.points.slice(0, -1), before.points);
  assert.deepEqual(withPoint.arcs, before.arcs);
  assert.equal(addNativePoint(before, 'a'), before);
  const withArc = addNativeArc(before);
  assert.equal(withArc.arcs.length, before.arcs.length + 1);
  assert.deepEqual(withArc.arcs.slice(0, -1), before.arcs);
  assert.deepEqual(removeNativeArc(withArc, before.arcs.length), before);
  const emptyCircle = { ...circle(), points: [], arcs: [] };
  assert.equal(addNativeArc(emptyCircle), emptyCircle);
  const onePoint = { ...emptyCircle, points: [point('one', '90^{\\circ}')] };
  const full = addNativeArc(onePoint);
  assert.equal(full.arcs[0].from, 'one');
  assert.equal(full.arcs[0].to, 'one');
  assert.equal(full.arcs[0].full_circle, true);
  assert.equal(validateExpertDiagram(full), null);
});

test('endpoint choices preserve point identity and never expose TeX as plain option text', () => {
  const options = nativeEndpointOptions(line());
  assert.deepEqual(
    options.map(({ id }) => id),
    ['-inf', 'a', 'b', 'c', '+inf'],
  );
  assert.equal(options[2].label, 'Точка 2');
  assert.equal(options[2].formula, '\\frac{2}{4}');
  assert.deepEqual(
    nativeEndpointOptions(circle()).map(({ id }) => id),
    ['a', 'b'],
  );
});

test('unknown untouched angle can be retained while changed math must be ready', () => {
  const harness = hookHarness();
  const load = moduleLoader({
    react: { ...harness.react, useEffectEvent: (callback) => callback },
  });
  const { useExpertNativeGeometry } = load('@/hooks/use-expert-native-geometry');
  let diagram = circle();
  const original = structuredClone(diagram);
  let valid;
  const render = () =>
    harness.render(() =>
      useExpertNativeGeometry(
        diagram,
        (next) => {
          diagram = next;
        },
        (ready) => {
          valid = ready;
        },
      ),
    );
  let editor = render();
  assert.equal(valid, true);
  editor.setMathValidity(CONFIG.fields.point('a'), false);
  editor = render();
  assert.equal(valid, true);
  assert.deepEqual(diagram, original);
  editor.setPointValue('a', '\\alpha');
  editor = render();
  assert.equal(valid, false);
  assert.equal(diagram.points[0].value, '\\alpha');
  editor.setMathValidity(CONFIG.fields.point('a'), true);
  editor = render();
  assert.equal(valid, true);
  editor.setPointValue('a', '');
  editor = render();
  assert.equal(valid, false);
  diagram = removeNativePoint(diagram, 'a');
  render();
  assert.equal(valid, true);
});

test('note edits preserve authored formatting and only an explicit clear produces null', () => {
  const harness = hookHarness();
  const load = moduleLoader({
    react: { ...harness.react, useEffectEvent: (callback) => callback },
  });
  const { useExpertNativeGeometry } = load('@/hooks/use-expert-native-geometry');
  let diagram = line();
  const render = () =>
    harness.render(() =>
      useExpertNativeGeometry(diagram, (next) => {
        diagram = next;
      }),
    );
  let editor = render();
  editor.setNote('  При $t \\ge 0$  ');
  assert.equal(diagram.note, '  При $t \\ge 0$  ');
  editor = render();
  editor.setNote('');
  assert.equal(diagram.note, null);
});
