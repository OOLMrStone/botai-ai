import assert from 'node:assert/strict';
import test from 'node:test';

import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

test('Ранний play вооружает RVFC, а playing сохраняет ожидание первого кадра', () => {
  const harness = hookHarness();
  const callbacks = new Map();
  const listeners = new Map();
  const draws = [];
  let handle = 0;
  let destroyed = false;
  const video = {
    readyState: 2,
    currentTime: 0,
    paused: true,
    ended: false,
    requestVideoFrameCallback(callback) {
      callbacks.set(++handle, callback);
      return handle;
    },
    cancelVideoFrameCallback: (id) => callbacks.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  const ref = { current: video };
  const load = moduleLoader(
    {
      react: { ...harness.react, useLayoutEffect: harness.react.useEffect },
      '@/lib/lemur-alpha-renderer': {
        createLemurAlphaRenderer: () => ({
          draw: (frame) => draws.push(frame.currentTime),
          destroy: () => {
            destroyed = true;
          },
        }),
      },
    },
    {
      window: { location: { search: '' } },
      HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
      document: {
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
      },
    },
  );
  const { useLemurAlphaFrame } = load('@/hooks/use-lemur-alpha-frame');
  let enabled = false;
  const render = () => harness.render(() => useLemurAlphaFrame(ref, enabled));
  const output = render();
  output.canvasRef.current = { dataset: {} };
  enabled = true;
  render();
  assert.equal(callbacks.size, 1, 'Преддекодированный paused-слот уже ждёт новый кадр');

  listeners.get('pause')();
  assert.equal(callbacks.size, 0);
  video.paused = false;
  listeners.get('play')();
  const firstPending = [...callbacks.keys()];
  assert.equal(firstPending.length, 1, 'Callback нужен до позднего playing');
  listeners.get('playing')();
  assert.deepEqual([...callbacks.keys()], firstPending, 'playing не должен отменять первый кадр');

  video.currentTime = 1 / 60;
  const callback = callbacks.get(firstPending[0]);
  callbacks.delete(firstPending[0]);
  callback(1000, { mediaTime: video.currentTime });
  assert.deepEqual(draws, [0, 1 / 60]);
  assert.equal(callbacks.size, 1);
  harness.unmount();
  assert.equal(callbacks.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(destroyed, true);
});

test('unloaded alpha slots allocate no GPU resources until a decoded frame arrives', () => {
  const harness = hookHarness();
  const listeners = new Map();
  let allocated = 0;
  let destroyed = 0;
  const video = {
    readyState: 0,
    currentTime: 0,
    paused: true,
    ended: false,
    requestVideoFrameCallback: () => 1,
    cancelVideoFrameCallback() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const load = moduleLoader(
    {
      react: harness.react,
      '@/lib/lemur-alpha-renderer': {
        createLemurAlphaRenderer: () => {
          allocated++;
          return { draw() {}, destroy: () => destroyed++ };
        },
      },
    },
    {
      HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
      document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    },
  );
  const { useLemurAlphaFrame } = load('@/hooks/use-lemur-alpha-frame');
  const ref = { current: video };
  const first = harness.render(() => useLemurAlphaFrame(ref, false));
  first.canvasRef.current = {};
  harness.render(() => useLemurAlphaFrame(ref, true));
  assert.equal(allocated, 0);
  video.readyState = 2;
  listeners.get('loadeddata')();
  assert.equal(allocated, 1);
  listeners.get('loadeddata')();
  assert.equal(allocated, 1);
  harness.unmount();
  assert.equal(destroyed, 1);
});
