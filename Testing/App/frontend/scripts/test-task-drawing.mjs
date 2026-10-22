import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compileFunction } from 'node:vm';

import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hookPath = 'src/hooks/use-task-drawing.ts';
const cardPath = 'src/components/tasks/TrainingTaskCard.tsx';
const baseline = process.env.DRAWING_TEST_BASELINE;
const toolIds = ['pencil', 'stroke-eraser', 'point-eraser'];

function readSource(path) {
  if (baseline && (path === hookPath || path === cardPath)) {
    return execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' });
  }
  return readFileSync(resolve(root, path), 'utf8');
}

// Проверяем и привязку JSX: корректный end бесполезен, если canvas вызывает rollback.
function canvasHandlers() {
  const source = ts.createSourceFile(cardPath, readSource(cardPath), ts.ScriptTarget.Latest, true);
  const handlers = {};
  const visit = (node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(source) === 'canvas'
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
        const name = attribute.name.getText(source);
        if (!['onPointerUp', 'onPointerCancel', 'onLostPointerCapture'].includes(name)) continue;
        assert.ok(ts.isJsxExpression(attribute.initializer));
        assert.ok(attribute.initializer.expression);
        handlers[name] = attribute.initializer.expression.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(Object.keys(handlers).length, 3);
  return handlers;
}

const handlers = canvasHandlers();
const originalStroke = () => ({
  id: 'existing-line',
  coordinateSpace: 'width',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.9, y: 0.1 },
  ],
});

function createHarness(tool, initialStrokes = []) {
  const taskId = 'test-drawing';
  const slots = [];
  const pendingEffects = [];
  let cursor = 0;
  let api;
  let commitCount = 0;
  let panDistance = 0;
  const state = {
    drawings: { [taskId]: structuredClone(initialStrokes) },
    savedDrawings: {},
    history: {},
    setDrawing: (id, strokes) => {
      state.drawings[id] = strokes;
    },
    commitDrawing: (id) => {
      commitCount += 1;
      state.savedDrawings[id] = structuredClone(state.drawings[id]);
    },
    finishDrawingGesture: () => {},
    markInProgress: (id) => {
      state.history[id] = 'in-progress';
    },
  };
  const sameDependencies = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const effect = (callback, dependencies) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && sameDependencies(previous.dependencies, dependencies)) return;
    pendingEffects.push(() => {
      previous?.cleanup?.();
      slots[index] = { dependencies, cleanup: callback() };
    });
  };
  const react = {
    useRef: (value) => {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState: (value) => {
      const index = cursor++;
      slots[index] ??= { value };
      return [
        slots[index].value,
        (next) => {
          slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
        },
      ];
    },
    useCallback: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
        slots[index] = { value: callback, dependencies };
      }
      return slots[index].value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const context = Object.fromEntries(
    ['setTransform', 'clearRect', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke'].map(
      (name) => [name, () => {}],
    ),
  );
  const canvas = {
    clientWidth: 1000,
    clientHeight: 1000,
    width: 1000,
    height: 1000,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    setPointerCapture: () => {},
  };
  const modules = new Map();
  const load = (path) => {
    if (modules.has(path)) return modules.get(path);
    const moduleRecord = { exports: {} };
    modules.set(path, moduleRecord.exports);
    const compiled = ts.transpileModule(readSource(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const requireModule = (name) => {
      if (name === 'react') return react;
      if (name === '@/stores/tasks-store') return { useTasksStore: (selector) => selector(state) };
      assert.ok(name.startsWith('@/'), `Unexpected dependency: ${name}`);
      return load(`src/${name.slice(2)}.ts`);
    };
    const evaluate = compileFunction(compiled, [
      'require',
      'module',
      'exports',
      'window',
      'ResizeObserver',
      'getComputedStyle',
    ]);
    evaluate(
      requireModule,
      moduleRecord,
      moduleRecord.exports,
      { devicePixelRatio: 1 },
      class {
        observe() {}
        disconnect() {}
      },
      () => ({ color: '#000' }),
    );
    return moduleRecord.exports;
  };
  const renderDrawingHook = load(hookPath).useTaskDrawing;
  const render = () => {
    cursor = 0;
    api = renderDrawingHook(
      taskId,
      () => {},
      () => {},
      (distance) => {
        panDistance += distance;
      },
    );
    api.canvasRef.current = canvas;
    while (pendingEffects.length) pendingEffects.shift()();
  };
  const pointer = (overrides = {}) => ({
    currentTarget: canvas,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 500,
    clientY: 100,
    ...overrides,
  });
  const send = (handler, overrides) => {
    assert.equal(typeof api[handler], 'function', `Canvas handler ${handler} must exist`);
    api[handler](pointer(overrides));
    render();
  };
  render();
  api.toggleTool(tool);
  render();

  return {
    down: (overrides) => send('start', overrides),
    move: (overrides) => send('move', overrides),
    terminal: (name, overrides) => send(handlers[name], overrides),
    strokes: () => structuredClone(state.drawings[taskId]),
    saved: () => state.savedDrawings[taskId],
    commits: () => commitCount,
    pan: () => panDistance,
  };
}

for (const tool of toolIds) {
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    for (const terminal of ['onPointerCancel', 'onLostPointerCapture']) {
      test(`${tool}, ${pointerType}: ${terminal} сохраняет изменения и освобождает следующий жест`, () => {
        const initial = tool === 'pencil' ? [] : [originalStroke()];
        const drawing = createHarness(tool, initial);
        drawing.down({ pointerType });
        drawing.move({ pointerType, clientX: 550 });
        const edited = drawing.strokes();
        assert.notDeepEqual(edited, initial);
        drawing.terminal(terminal, { pointerType });
        assert.deepEqual(drawing.strokes(), edited);
        assert.deepEqual(drawing.saved(), edited);
        assert.equal(drawing.commits(), 1);
        drawing.terminal('onPointerUp', { pointerType });
        drawing.terminal('onLostPointerCapture', { pointerType });
        assert.equal(drawing.commits(), 1);
        drawing.down({ pointerType, pointerId: 2, clientX: 150 });
        drawing.move({ pointerType, pointerId: 2, clientX: 200 });
        drawing.terminal('onPointerUp', { pointerType, pointerId: 2 });
        assert.equal(drawing.commits(), 2);
      });
    }
  }

  test(`${tool}: обычный up сохраняет, последующие lost/cancel и чужой pointer безопасны`, () => {
    const drawing = createHarness(tool, tool === 'pencil' ? [] : [originalStroke()]);
    drawing.down();
    drawing.move({ clientX: 550 });
    const edited = drawing.strokes();
    for (const terminal of ['onPointerUp', 'onPointerCancel', 'onLostPointerCapture']) {
      drawing.terminal(terminal, { pointerId: 99 });
    }
    assert.equal(drawing.commits(), 0);
    assert.deepEqual(drawing.strokes(), edited);
    drawing.terminal('onPointerUp');
    drawing.terminal('onLostPointerCapture');
    drawing.terminal('onPointerCancel');
    assert.deepEqual(drawing.saved(), edited);
    assert.equal(drawing.commits(), 1);
  });

  test(`${tool}: pan двумя пальцами откатывает только текущий жест`, () => {
    const initial = [originalStroke()];
    const drawing = createHarness(tool, initial);
    drawing.down({ pointerType: 'touch' });
    drawing.move({ pointerType: 'touch', clientX: 550 });
    assert.notDeepEqual(drawing.strokes(), initial);
    drawing.down({ pointerType: 'touch', pointerId: 2, clientY: 200 });
    assert.deepEqual(drawing.strokes(), initial);
    drawing.move({ pointerType: 'touch', pointerId: 2, clientY: 240 });
    assert.notEqual(drawing.pan(), 0);
    drawing.terminal('onPointerUp', { pointerType: 'touch' });
    drawing.terminal('onPointerUp', { pointerType: 'touch', pointerId: 2 });
    assert.equal(drawing.commits(), 0);
    drawing.down({ pointerType: 'touch', pointerId: 3 });
    drawing.terminal('onPointerUp', { pointerType: 'touch', pointerId: 3 });
    assert.equal(drawing.commits(), 1);
  });
}
