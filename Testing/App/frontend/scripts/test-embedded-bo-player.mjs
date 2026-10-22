import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hookHarness, moduleLoader, settle } from './helpers/hook-harness.mjs';

test('embedded player pauses offscreen and releases observers and gesture retry listeners', () => {
  const harness = hookHarness();
  const requests = [];
  const listeners = new Map();
  let observation;
  let disconnected = 0;
  let started = 0;
  const target = {};
  const load = moduleLoader(
    {
      react: { ...harness.react, useEffectEvent: (fn) => fn },
      '@/hooks/use-lemur-preview': {
        useLemurPreview: (_, suspended) => {
          requests.push(suspended);
          return {
            start: () => started++,
            react: () => {},
            reducedMotion: false,
            requiresInteraction: true,
          };
        },
      },
    },
    {
      IntersectionObserver: class {
        constructor(callback) {
          observation = callback;
        }
        observe(element) {
          assert.equal(element, target);
        }
        disconnect() {
          disconnected++;
        }
      },
      document: {
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: (name) => listeners.delete(name),
      },
    },
  );
  const { useEmbeddedBo } = load('@/hooks/use-embedded-bo');
  const render = () => harness.render(() => useEmbeddedBo({}, target));
  assert.equal(render().preload, 'none');
  assert.equal(requests.at(-1), true);
  assert.equal(listeners.size, 0);
  observation([{ isIntersecting: true }]);
  assert.equal(render().preload, 'auto');
  assert.equal(requests.at(-1), false);
  listeners.get('pointerup')();
  assert.equal(started, 1);
  observation([{ isIntersecting: false }]);
  assert.equal(render().preload, 'none');
  assert.equal(requests.at(-1), true);
  assert.equal(listeners.size, 0);
  harness.unmount();
  assert.equal(disconnected, 1);
});

test('prepared video starts synchronously in the opening gesture without replacing its instance', () => {
  const harness = hookHarness();
  const events = [];
  const video = {
    getAttribute: () => 'prepared.mp4',
    play: () => {
      events.push('play');
      return Promise.resolve();
    },
    pause: () => {},
  };
  const buffer = {
    ref: { current: null },
    pendingRef: { current: video },
    firstRef: { current: video },
    secondRef: { current: null },
    ready: false,
    activeSlot: 0,
  };
  const load = moduleLoader(
    {
      react: { ...harness.react, useEffectEvent: (fn) => fn },
      '@/hooks/use-lemur-video-buffer': { useLemurVideoBuffer: () => buffer },
    },
    { document: { hidden: false } },
  );
  const { useLemurVideo } = load('@/hooks/use-lemur-video');
  const player = harness.render(() =>
    useLemurVideo({ source: 'prepared.mp4', paused: true, playbackRate: 1, loop: true }),
  );
  player.start();
  events.push('navigate');
  assert.deepEqual(events, ['play', 'navigate']);
  assert.equal(player.firstRef.current, video);
  assert.equal(video.loop, true);
});

test('reduced motion keeps embedded reactions still even after a tap', () => {
  const harness = hookHarness();
  let calls = 0;
  const load = moduleLoader({
    react: { ...harness.react, useEffectEvent: (fn) => fn },
    '@/hooks/use-lemur-preview': {
      useLemurPreview: () => ({
        start: () => calls++,
        react: () => calls++,
        reducedMotion: true,
        requiresInteraction: false,
      }),
    },
  });
  const player = harness.render(() => load('@/hooks/use-embedded-bo').useEmbeddedBo({}, null));
  assert.equal(player.preload, 'none');
  player.react();
  assert.equal(calls, 0);
});

function videoFixture(events) {
  let source = null;
  const listeners = new Map();

  return {
    get src() {
      return source;
    },
    set src(value) {
      source = value;
      events.push(`src:${value}`);
    },
    getAttribute: (name) => (name === 'src' ? source : null),
    load: () => events.push('load'),
    play: () => {
      events.push('play');
      return Promise.resolve();
    },
    pause: () => {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    emit: (name) => listeners.get(name)?.(),
    readyState: 0,
    currentTime: 0,
    seeking: false,
    error: null,
  };
}

const mediaReadiness = { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

test('disabled video buffer leaves both sources untouched until enabled', () => {
  const harness = hookHarness();
  const firstEvents = [];
  const secondEvents = [];
  const first = videoFixture(firstEvents);
  const second = videoFixture(secondEvents);
  const load = moduleLoader(
    { react: { ...harness.react, useEffectEvent: (fn) => fn } },
    { HTMLMediaElement: mediaReadiness },
  );
  const { useLemurVideoBuffer } = load('@/hooks/use-lemur-video-buffer');
  let enabled = false;
  let source = 'idle.mp4';
  const render = () =>
    harness.render(() =>
      useLemurVideoBuffer({
        enabled,
        source,
        prepared: { source: 'reaction.mp4' },
        onReady: () => {},
        onError: () => {},
      }),
    );
  let buffer = render();
  buffer.firstRef.current = first;
  buffer.secondRef.current = second;
  source = 'next-idle.mp4';
  buffer = render();

  assert.equal(first.getAttribute('src'), null);
  assert.equal(second.getAttribute('src'), null);
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(secondEvents, []);
  assert.equal(buffer.pendingRef.current, null);

  enabled = true;
  buffer = render();
  assert.deepEqual(firstEvents, ['src:next-idle.mp4', 'load']);
  assert.deepEqual(secondEvents, []);
  assert.equal(buffer.pendingRef.current, first);
  assert.equal(buffer.firstRef.current, first);
  harness.unmount();
});

test('deferred video loads and plays in the first gesture and repeated starts reuse the source', async () => {
  const harness = hookHarness();
  const events = [];
  const first = videoFixture(events);
  const second = videoFixture([]);
  const load = moduleLoader(
    { react: { ...harness.react, useEffectEvent: (fn) => fn } },
    {
      HTMLMediaElement: mediaReadiness,
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
    },
  );
  const { useLemurVideo } = load('@/hooks/use-lemur-video');
  const render = () =>
    harness.render(() =>
      useLemurVideo({
        source: 'deferred.mp4',
        deferLoad: true,
        paused: true,
        playbackRate: 1,
        loop: true,
      }),
    );
  let player = render();
  player.firstRef.current = first;
  player.secondRef.current = second;
  assert.equal(player.ref.current, null);
  assert.equal(player.pendingRef.current, null);
  assert.equal(first.getAttribute('src'), null);
  assert.deepEqual(events, []);

  player.start();
  events.push('gesture-finished');
  assert.deepEqual(events, ['src:deferred.mp4', 'load', 'play', 'gesture-finished']);
  assert.equal(player.firstRef.current, first);
  player = render();
  assert.equal(player.pendingRef.current, first);
  assert.deepEqual(events, ['src:deferred.mp4', 'load', 'play', 'gesture-finished']);

  first.readyState = mediaReadiness.HAVE_CURRENT_DATA;
  first.emit('loadeddata');
  player = render();
  assert.equal(player.ref.current, first);
  assert.equal(player.firstRef.current, first);
  assert.equal(player.ready, true);
  player.start();
  assert.deepEqual(events, ['src:deferred.mp4', 'load', 'play', 'gesture-finished', 'play']);
  assert.equal(first.loop, true);
  await settle();
  harness.unmount();
});
