import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import { moduleLoader, hookHarness } from './helpers/hook-harness.mjs';

const load = moduleLoader();
const geometry = load('@/lib/grid-geometry');
const { expertNumberLineFeedback } = load('@/lib/expert-geometry-feedback');
const { buildExpertNumberLine, buildExpertUnitCircle } = load('@/lib/expert-diagram');
const { buildExpertNativeNumberLine, buildExpertNativeUnitCircle, parseExpertNativeAngle } = load(
  '@/lib/expert-native-diagram',
);

const axis = {
  label: 'x',
  min: -1,
  max: 3,
  domain: null,
  points: [
    { id: 'a', value: 0, label: '0', included: false, marker: null, sign: null },
    { id: 'b', value: 2, label: '2', included: true, sign: '0' },
  ],
  intervals: [
    { id: 'middle', from: 0, to: 2, sign: '-', selected: false },
    { id: 'ray', from: 2, to: null, sign: '+', selected: true },
  ],
  selectedPoints: ['b'],
};
const circle = {
  points: [
    { id: 'a', angle: 0, label: '0', selected: false, marker: null },
    { id: 'b', angle: Math.PI / 2, label: '\\pi/2', selected: true },
  ],
  arcs: [{ id: 'arc', from: 0, to: Math.PI / 2, direction: 'ccw', selected: true }],
};

function blockEditor(initial) {
  const harness = hookHarness();
  const { useGridBlockEditor } = moduleLoader({ react: harness.react })('@/hooks/use-grid-editor');
  const applied = [];
  const task = {
    blocks: [{ id: 'source', status: 'error' }, initial],
  };
  const render = () =>
    harness.render(() => useGridBlockEditor(initial, task, (block) => applied.push(block)));

  return { render, applied };
}

test('geometry feedback locates duplicate coordinates and clears when the value is corrected', () => {
  const duplicated = {
    ...axis,
    points: [...axis.points, { ...axis.points[0], id: 'duplicate' }],
  };
  const feedback = expertNumberLineFeedback(duplicated);
  assert.ok(feedback.points.get('a'));
  assert.ok(feedback.points.get('duplicate'));
  assert.equal(feedback.points.get('b'), null);
  const corrected = {
    ...duplicated,
    points: duplicated.points.map((point) =>
      point.id === 'duplicate' ? { ...point, value: 1, label: '1' } : point,
    ),
  };
  assert.deepEqual([...expertNumberLineFeedback(corrected).points.values()], [null, null, null]);
});

test('correcting or deleting a duplicate point preserves boundaries belonging to the original point', () => {
  const duplicated = {
    ...axis,
    points: [...axis.points, { ...axis.points[0], id: 'duplicate' }],
  };
  const corrected = geometry.updateGeometryPoint(duplicated, 'duplicate', { value: 1, label: '1' });
  assert.deepEqual(corrected.intervals, axis.intervals);
  assert.equal(corrected.points.find((point) => point.id === 'a').value, 0);
  assert.equal(corrected.points.find((point) => point.id === 'duplicate').value, 1);
  assert.equal(expertNumberLineFeedback(corrected).points.get('duplicate'), null);
  assert.deepEqual(geometry.removeGeometryPoint(duplicated, 'duplicate'), axis);
});

test('geometry feedback explains inverted or equal interval ends and keeps infinite rays valid', () => {
  for (const to of [0, 2]) {
    const changed = {
      ...axis,
      intervals: [{ ...axis.intervals[0], from: 2, to }, axis.intervals[1]],
    };
    const feedback = expertNumberLineFeedback(changed);
    assert.ok(feedback.intervals.get('middle'));
    assert.equal(feedback.intervals.get('ray'), null);
  }
  const invalidBounds = expertNumberLineFeedback({
    ...axis,
    min: axis.max,
    domain: { from: 2, to: 2 },
  });
  assert.ok(invalidBounds.axis);
  assert.ok(invalidBounds.domain);
  assert.equal(
    expertNumberLineFeedback({ ...axis, domain: { from: null, to: null } }).domain,
    null,
  );
});

test('undefined or infinite intermediate values cannot become a finite coordinate later', () => {
  for (const text of [
    '\\sqrt{-1}^{0}',
    '(\\frac{1}{0})^{0}',
    '\\ln(-1)^{0}',
    '\\frac{1}{\\frac{1}{0}}',
    '\\frac{1}{10^{10000}}',
    '(10^{10000})^{0}',
  ]) {
    assert.deepEqual(geometry.parseGeometryExpression(text), { valid: false, value: null }, text);
  }
  assert.deepEqual(geometry.parseGeometryExpression('\\sqrt2'), {
    valid: true,
    value: Math.sqrt(2),
  });
  assert.deepEqual(geometry.parseGeometryExpression('\\frac{1}{1/2}'), { valid: true, value: 2 });
});

test('moving a point retains dependent boundaries and expands its visible range', () => {
  const moved = geometry.updateGeometryPoint(axis, 'b', { value: 5 });
  assert.equal(moved.intervals[0].to, 5);
  assert.equal(moved.intervals[1].from, 5);
  assert.ok(moved.max > 5);
  assert.equal(moved.points[1].id, 'b');
  assert.deepEqual(
    axis.intervals.map(({ from, to }) => [from, to]),
    [
      [0, 2],
      [2, null],
    ],
  );
  assert.equal(
    geometry.updateGeometryCirclePoint(circle, 'b', { angle: Math.PI }).arcs[0].to,
    Math.PI,
  );
});

test('removing points removes dependent intervals or arcs and stale selections', () => {
  const nextAxis = geometry.removeGeometryPoint(axis, 'b');
  assert.deepEqual(nextAxis.selectedPoints, []);
  assert.deepEqual(nextAxis.intervals, []);
  assert.equal(nextAxis.points.length, 1);
  assert.deepEqual(geometry.removeGeometryCirclePoint(circle, 'a').arcs, []);
});

test('moving coordinates updates default labels while preserving explicit math labels', () => {
  assert.equal(geometry.updateGeometryPoint(axis, 'b', { value: 4 }).points[1].label, '4');
  const customAxis = structuredClone(axis);
  customAxis.points[1].label = '\\sqrt{4}';
  assert.equal(
    geometry.updateGeometryPoint(customAxis, 'b', { value: 4 }).points[1].label,
    '\\sqrt{4}',
  );
  assert.equal(
    geometry.updateGeometryPoint(axis, 'b', { value: 4, label: 'a' }).points[1].label,
    'a',
  );
  assert.equal(
    geometry.updateGeometryCirclePoint(circle, 'b', { angle: Math.PI }).points[1].label,
    '\\pi',
  );
  const customCircle = structuredClone(circle);
  customCircle.points[1].label = '\\alpha';
  assert.equal(
    geometry.updateGeometryCirclePoint(customCircle, 'b', { angle: Math.PI }).points[1].label,
    '\\alpha',
  );
});

test('an unknown marker remains unknown until an explicit expert edit', () => {
  assert.equal(buildExpertNumberLine(axis).points[0].hasMarker, false);
  assert.equal(buildExpertUnitCircle(circle).points[0].hasMarker, false);
  assert.equal(
    geometry.updateGeometryPoint(axis, 'a', { included: true }).points[0].marker,
    'closed',
  );
  assert.equal(
    geometry.updateGeometryPoint(axis, 'a', { included: false }).points[0].marker,
    'open',
  );
  assert.equal(
    geometry.updateGeometryCirclePoint(circle, 'a', { selected: true }).points[0].marker,
    'closed',
  );
});

test('a full circle with equal canonical endpoints renders two visible semicircles', () => {
  const diagram = buildExpertUnitCircle({
    ...circle,
    arcs: [{ id: 'full', from: 0, to: 0, direction: 'cw', selected: true }],
  });
  assert.equal(diagram.arcs[0].path.match(/ A /g).length, 2);
});

test('coincident circle points keep separate arc endpoints when moved, removed or selected', () => {
  const coincident = {
    points: [
      { id: 'a', angle: 0, label: 'a', selected: false },
      { id: 'b', angle: 0, label: 'b', selected: false },
      { id: 'c', angle: Math.PI, label: 'c', selected: false },
    ],
    arcs: [
      {
        id: 'a-c',
        from: 0,
        to: Math.PI,
        fromPointId: 'a',
        toPointId: 'c',
        fullCircle: false,
        direction: 'ccw',
        selected: true,
      },
      {
        id: 'b-c',
        from: 0,
        to: Math.PI,
        fromPointId: 'b',
        toPointId: 'c',
        fullCircle: false,
        direction: 'ccw',
        selected: true,
      },
    ],
  };
  const moved = geometry.updateGeometryCirclePoint(coincident, 'a', { angle: Math.PI / 2 });
  assert.equal(moved.arcs[0].from, Math.PI / 2);
  assert.equal(moved.arcs[1].from, 0);
  assert.deepEqual(geometry.removeGeometryCirclePoint(coincident, 'a').arcs, [coincident.arcs[1]]);
  const selected = geometry.setGeometryCircleEndpoint(coincident, 'a-c', 'from', 0, 'b');
  assert.equal(selected.arcs[0].fromPointId, 'b');
  assert.equal(selected.arcs[0].fullCircle, false);
  const full = geometry.setGeometryCircleEndpoint(selected, 'a-c', 'to', 0, 'b');
  assert.equal(full.arcs[0].fullCircle, true);
  const distinct = geometry.setGeometryCircleEndpoint(full, 'a-c', 'to', 0, 'a');
  assert.equal(distinct.arcs[0].fullCircle, false);
  assert.equal(buildExpertUnitCircle(distinct).arcs[0].path.match(/ A /g).length, 1);
});

test('visual math readiness requires every current field and ignores removed fields', () => {
  const harness = hookHarness();
  const { useGridMathValidity } = moduleLoader({ react: harness.react })(
    '@/hooks/use-grid-math-validity',
  );
  let ids = ['a', 'b'];
  const render = () => harness.render(() => useGridMathValidity(ids));
  assert.equal(render().valid, false);
  render().setValidity('a', true);
  assert.equal(render().valid, false);
  render().setValidity('b', true);
  assert.equal(render().valid, true);
  render().setValidity('b', false);
  assert.equal(render().valid, false);
  ids = ['a'];
  assert.equal(render().valid, true);
});

test('visual angles parse MathLive fractions, pi, signed decimals and grouped arithmetic', () => {
  for (const [latex, expected] of [
    ['\\frac{5\\pi}{6}', (5 * Math.PI) / 6],
    ['-\\dfrac{\\pi}{2}', -Math.PI / 2],
    ['2\\pi/3', (2 * Math.PI) / 3],
    ['\\frac{1}{2}\\pi', Math.PI / 2],
    ['\\left(\\pi+\\pi\\right)/6', Math.PI / 3],
    ['−0,5', -0.5],
    ['\\frac{\\frac{1}{2}}{3}', 1 / 6],
    ['0', 0],
  ]) {
    const parsed = geometry.parseGeometryExpression(latex);
    assert.equal(parsed.valid, true, latex);
    assert.ok(Math.abs(parsed.value - expected) < 1e-10, latex);
  }
  for (const latex of ['', '-', '\\frac{π}{}', '\\frac{1}{0}', 'π/', '\\alpha', 'x', '1e3', '1)'])
    assert.equal(geometry.parseGeometryExpression(latex).valid, false, latex);
});

test('a single visual angle draft blocks invalid edits and updates angle with its label', () => {
  const harness = hookHarness();
  const { useGridGeometry } = moduleLoader({ react: harness.react })('@/hooks/use-grid-geometry');
  let current = structuredClone(circle);
  const render = () => harness.render(() => useGridGeometry(['b']));
  const field = () =>
    render().expression(
      'b',
      geometry.geometryCircleAngleValue(current.points[1]),
      (angle, label) => {
        current = geometry.updateGeometryCirclePoint(current, 'b', { angle, label });
      },
    );
  render().setMathValidity('b', true);
  field().onChange('\\frac{π}{}');
  assert.equal(field().value, '\\frac{π}{}');
  assert.equal(render().valid, false);
  assert.equal(current.points[1].angle, Math.PI / 2);
  field().onChange('\\frac{5\\pi}{6}');
  assert.equal(render().valid, true);
  assert.equal(current.points[1].label, '\\frac{5\\pi}{6}');
  assert.equal(current.points[1].angle, (5 * Math.PI) / 6);
  assert.equal(current.arcs[0].to, (5 * Math.PI) / 6);
  assert.equal(
    geometry.geometryCircleAngleValue({ ...current.points[1], label: '\\alpha' }),
    '5\\pi/6',
  );
});

test('coordinate expressions support roots, powers and logarithms without evaluating code', () => {
  for (const [text, expected] of [
    ['\\sqrt{2}', Math.sqrt(2)],
    ['\\sqrt2', Math.sqrt(2)],
    ['-2^2', -4],
    ['2^{3^2}', 512],
    ['\\frac{1+\\sqrt{5}}{2}', (1 + Math.sqrt(5)) / 2],
    ['\\sqrt[3]{-8}', -2],
    ['\\log_{2}(8)', 3],
    ['\\ln(e)', 1],
    ['\\sin(\\pi/6)', 0.5],
    ['\\cos(0)', 1],
  ]) {
    const parsed = geometry.parseGeometryExpression(text);
    assert.equal(parsed.valid, true, text);
    assert.ok(Math.abs(parsed.value - expected) < 1e-10, text);
  }
  for (const text of [
    '\\sqrt{-1}',
    '2^{',
    '\\log_{1}(2)',
    '\\ln(-1)',
    '\\tan(\\pi/2)',
    'x+1',
    'alert(1)',
    '1/0',
    '2^999999',
    '('.repeat(100) + '1' + ')'.repeat(100),
  ]) {
    assert.equal(geometry.parseGeometryExpression(text).valid, false, text);
  }
});

test('a coordinate edits its label, diagram position and linked boundaries atomically', () => {
  const harness = hookHarness();
  const { useGridGeometry } = moduleLoader({ react: harness.react })('@/hooks/use-grid-geometry');
  let current = structuredClone(axis);
  const render = () => harness.render(() => useGridGeometry(['b']));
  const field = () =>
    render().expression(
      'b',
      geometry.geometryPointExpression(current.points[1]),
      (value, label) => {
        current = geometry.updateGeometryPoint(current, 'b', { value, label });
      },
    );
  render().setMathValidity('b', true);
  field().onChange('\\sqrt{2}');
  assert.equal(current.points[1].label, '\\sqrt{2}');
  assert.equal(current.intervals[0].to, Math.sqrt(2));
  assert.equal(current.intervals[1].from, Math.sqrt(2));
  field().onChange('x');
  assert.equal(render().valid, false);
  assert.equal(current.points[1].value, Math.sqrt(2));
});

test('infinite sign curves stay off the axis while finite endpoints still meet it', () => {
  const { axis: axisGeometry } = load('@/config/expert-solution-layout').expertSolutionLayout
    .numberLine;
  for (const sign of ['+', '-']) {
    const diagram = buildExpertNumberLine({
      ...axis,
      intervals: [
        { id: 'left', from: null, to: 0, sign },
        { id: 'right', from: 2, to: null, sign },
        { id: 'all', from: null, to: null, sign },
        { id: 'finite', from: axis.min, to: axis.max, sign },
      ],
    });
    const paths = diagram.intervals.map(({ curve }) => curve.match(/-?\d+(?:\.\d+)?/g).map(Number));
    const [left, right, all, finite] = paths;
    const y = axisGeometry.y1;
    assert.equal(left.at(-1), y);
    assert.equal(right[1], y);
    assert.equal(left[1], right.at(-1));
    assert.equal(left[1], left[3]);
    assert.equal(right.at(-1), right.at(-3));
    assert.equal(all[1], all.at(-1));
    assert.equal(finite[1], y);
    assert.equal(finite.at(-1), y);
    assert.ok(sign === '+' ? left[1] < y : left[1] > y);
  }
});

test('nested diagram edits retain one step with its lines, status and cause', () => {
  for (const diagram of [
    { kind: 'number_line', axis: structuredClone(axis) },
    { kind: 'unit_circle', circle: structuredClone(circle) },
  ]) {
    const initial = {
      id: 'step',
      title: 'Отбор решений',
      kind: 'step',
      lines: ['Проверим точки', '$x > 0$'],
      status: 'follow_through',
      explanation: 'Следствие предыдущего шага',
      followsFromBlockIds: ['source'],
      diagram,
    };
    const editor = blockEditor(initial);
    editor.render().setRichTextValid(true);
    const changed =
      diagram.kind === 'number_line'
        ? { ...diagram, axis: geometry.updateGeometryPoint(diagram.axis, 'b', { value: 5 }) }
        : {
            ...diagram,
            circle: geometry.updateGeometryCirclePoint(diagram.circle, 'b', { angle: Math.PI }),
          };

    editor.render().setDiagram(changed);
    editor.render().apply();

    assert.equal(editor.applied.length, 1);
    assert.deepEqual(editor.applied[0], { ...initial, diagram: changed });
    assert.deepEqual(initial.diagram, diagram);
    assert.equal(editor.applied[0].diagram.id, undefined);
    editor.render().setText('Новая запись\n$x > 2$');
    assert.deepEqual(editor.render().block.lines, ['Новая запись', '$x > 2$']);
    assert.deepEqual(editor.render().block.diagram, changed);
  }
});

test('a step cannot apply until both its rich text and diagram fields are valid', () => {
  const initial = {
    id: 'step',
    title: 'Метод интервалов',
    kind: 'step',
    lines: ['$x > 0$'],
    status: 'correct',
    explanation: '',
    diagram: { kind: 'number_line', axis: structuredClone(axis) },
  };
  const editor = blockEditor(initial);
  assert.equal(editor.render().canApply, false);
  editor.render().setRichTextValid(true);
  assert.equal(editor.render().canApply, true);
  editor.render().setGeometryValid(false);
  editor.render().apply();
  assert.equal(editor.applied.length, 0);
  editor.render().setGeometryValid(true);
  editor.render().setDiagram({
    kind: 'number_line',
    axis: { ...axis, min: axis.max },
  });
  assert.equal(editor.render().canApply, false);
  editor.render().setDiagram(initial.diagram);
  assert.equal(editor.render().canApply, true);
});

test('diagram-only steps apply without requiring empty text to pass rich text validation', () => {
  const editor = blockEditor({
    id: 'step',
    title: 'Тригонометрическая окружность',
    kind: 'step',
    lines: [],
    status: 'correct',
    explanation: '',
    diagram: { kind: 'unit_circle', circle: structuredClone(circle) },
  });

  assert.equal(editor.render().canApply, true);
  editor.render().setGeometryValid(false);
  assert.equal(editor.render().canApply, false);
});

test('the shared diagram editor keeps standalone block metadata unchanged', () => {
  const initial = {
    id: 'standalone',
    title: 'Метод интервалов',
    kind: 'number_line',
    axis: structuredClone(axis),
    status: 'warning',
    explanation: 'Проверь границу',
  };
  const editor = blockEditor(initial);
  const changed = geometry.updateGeometryPoint(initial.axis, 'b', { value: 4 });
  editor.render().setDiagram({ kind: 'number_line', axis: changed });
  editor.render().apply();

  assert.deepEqual(editor.applied, [{ ...initial, axis: changed }]);
  assert.equal(editor.render().block.diagram, undefined);
});

const nativeLine = {
  kind: 'number_line_v2',
  variable: 't',
  note: 'При $t > 0$',
  points: [
    { id: 'p', value: '1000', included: false, sign: null },
    { id: 'q', value: '-2', included: true, sign: '0' },
    { id: 'r', value: '\\alpha', included: null, sign: null, bound: true },
  ],
  arcs: [
    { from: '-inf', to: 'p', sign: '+', selected: false },
    { from: 'q', to: 'q', sign: '0', selected: true },
    { from: 'r', to: '+inf', sign: '-', selected: false },
  ],
};

const nativeCircle = {
  kind: 'unit_circle_v2',
  points: [
    { id: 'p', value: '0', included: false, sign: null },
    { id: 'q', value: '\\pi/2', included: true, sign: '0' },
    { id: 'r', value: '\\alpha', included: null, sign: '+', bound: true },
  ],
  arcs: [
    { from: 'p', to: 'q', sign: '+', selected: false, direction: 'ccw', full_circle: false },
    { from: 'p', to: 'q', sign: '-', selected: true, direction: 'cw', full_circle: false },
    { from: 'q', to: 'r', sign: null, selected: false, direction: 'ccw', full_circle: false },
  ],
};

test('native line keeps point order and equal spacing without parsing or sorting values', () => {
  const snapshot = structuredClone(nativeLine);
  const rendered = buildExpertNativeNumberLine(nativeLine);
  assert.deepEqual(
    rendered.points.map((point) => point.id),
    ['p', 'q', 'r'],
  );
  assert.deepEqual(
    rendered.points.map((point) => point.value),
    ['1000', '-2', '\\alpha'],
  );
  assert.ok(
    Math.abs(
      rendered.points[1].x - rendered.points[0].x - (rendered.points[2].x - rendered.points[1].x),
    ) < 1e-10,
  );
  assert.deepEqual(nativeLine, snapshot);
  assert.equal(rendered.arcs.length, nativeLine.arcs.length);
  assert.deepEqual(
    rendered.arcs.map((arc) => [arc.from, arc.to, arc.sign, arc.selected]),
    nativeLine.arcs.map((arc) => [arc.from, arc.to, arc.sign, arc.selected]),
  );
});

test('native sparse arcs keep self loops, signs and infinite tails without inventing intervals', () => {
  const rendered = buildExpertNativeNumberLine(nativeLine);
  const y = rendered.axis.y1;
  const [left, loop, right] = rendered.arcs;
  const numbers = (path) => path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.notEqual(numbers(left.path)[1], y);
  assert.equal(numbers(left.path).at(-1), y);
  assert.equal(numbers(right.path)[1], y);
  assert.notEqual(numbers(right.path).at(-1), y);
  assert.equal(loop.loop, true);
  assert.equal(loop.start, loop.end);
  assert.match(loop.path, / C /);
  assert.equal(loop.sign, '0');
  assert.equal(loop.selected, true);
  assert.equal(rendered.points[2].bound, true);
  assert.equal(rendered.points[2].included, null);
  const all = buildExpertNativeNumberLine({
    ...nativeLine,
    arcs: [{ from: '-inf', to: '+inf', sign: null, selected: false }],
  });
  assert.equal(all.arcs.length, 1);
  assert.equal(all.arcs[0].sign, null);
  assert.notEqual(numbers(all.arcs[0].path)[1], y);
  assert.notEqual(numbers(all.arcs[0].path).at(-1), y);
});

test('native angle parsing accepts explicit degrees and preserves plain radians', () => {
  for (const value of ['90°', '90^{\\circ}', '90^\\circ']) {
    assert.deepEqual(parseExpertNativeAngle(value), { valid: true, value: Math.PI / 2 });
  }
  assert.deepEqual(parseExpertNativeAngle('90'), { valid: true, value: 90 });
  assert.deepEqual(parseExpertNativeAngle('\\frac{5\\pi}{6}'), {
    valid: true,
    value: (5 * Math.PI) / 6,
  });
  assert.deepEqual(parseExpertNativeAngle('\\alpha'), { valid: false, value: null });
  assert.deepEqual(parseExpertNativeAngle('unknown°'), { valid: false, value: null });
});

test('native circle honors direction and explicit full-circle while unresolved angles stay unresolved', () => {
  const snapshot = structuredClone(nativeCircle);
  const rendered = buildExpertNativeUnitCircle(nativeCircle);
  assert.deepEqual(nativeCircle, snapshot);
  assert.deepEqual(
    rendered.points.map((point) => point.value),
    ['0', '\\pi/2'],
  );
  assert.deepEqual(rendered.unknownPoints, [nativeCircle.points[2]]);
  assert.equal(rendered.missingArcs, 1);
  assert.equal(rendered.arcs.length, 2);
  assert.match(rendered.arcs[0].path, / A \d+ \d+ 0 0 0 /);
  assert.match(rendered.arcs[1].path, / A \d+ \d+ 0 1 1 /);
  assert.equal(rendered.arcs[0].sign, '+');
  assert.equal(rendered.arcs[1].sign, '-');
  const equalEndpoints = (full_circle) =>
    buildExpertNativeUnitCircle({
      ...nativeCircle,
      arcs: [{ ...nativeCircle.arcs[0], to: 'p', full_circle }],
    }).arcs[0];
  assert.equal(equalEndpoints(false).path.match(/ A /g).length, 1);
  assert.equal(equalEndpoints(true).path.match(/ A /g).length, 2);
});

test('native renderer preserves diagram content and safely explains unresolved angles', () => {
  const { ExpertDiagramContent } = moduleLoader({ katex: { default: katex } })(
    '@/components/expert/ExpertDiagramContent',
  );
  const render = (diagram) =>
    renderToStaticMarkup(createElement(ExpertDiagramContent, { diagram }));
  const lineHtml = render({ ...nativeLine, note: '<img src=x onerror=alert(1)>' });
  assert.match(lineHtml, /Интервальная прямая/);
  assert.match(lineHtml, /stroke-dasharray=/);
  assert.match(lineHtml, />0<\/text>/);
  assert.match(lineHtml, /&lt;img/);
  assert.doesNotMatch(lineHtml, /<img|<button|<input/);
  const variableHtml = render({ ...nativeLine, variable: '\\theta' });
  assert.match(variableHtml, /θ/);
  assert.doesNotMatch(variableHtml, /<text[^>]*>\\theta<\/text>/);
  const domainHtml = render({
    ...nativeLine,
    points: [{ id: 'zero', value: '0', included: null, sign: null, bound: true }],
    arcs: [],
  });
  assert.match(domainHtml, /stroke-dasharray=/);
  assert.match(domainHtml, /При/);
  assert.doesNotMatch(domainHtml, /<circle /);
  const circleHtml = render(nativeCircle);
  assert.match(circleHtml, /Тригонометрическая окружность/);
  assert.match(circleHtml, /Сверь их с оригиналом решения/);
  assert.match(circleHtml, /\\alpha/);
  assert.match(circleHtml, />0<\/text>/);
  assert.equal(circleHtml.match(/<path /g).length, 2);
});
