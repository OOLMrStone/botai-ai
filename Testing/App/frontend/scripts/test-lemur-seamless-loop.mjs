import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hookHarness, moduleLoader, settle } from './helpers/hook-harness.mjs';

const motion = JSON.parse(readFileSync('src/config/lemur-hang-motion.json', 'utf8'));
const timing = { duration: motion.duration, fps: motion.fps, overlap: motion.loopOverlap };
const frameTime = 1 / timing.fps;
const readiness = { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

function playerFixture(rate = 1) {
  const harness = hookHarness();
  const paints = new Map();
  const documentEvents = new Map();
  let handle = 0;
  let wallTime = 0;
  let player;
  let options = {
    source: 'idle.mp4',
    deferLoad: true,
    paused: false,
    playbackRate: rate,
    loop: true,
    seamlessLoop: timing,
  };
  const document = {
    hidden: false,
    addEventListener: (name, callback) => documentEvents.set(name, callback),
    removeEventListener: (name) => documentEvents.delete(name),
  };
  const makeVideo = () => {
    const listeners = new Map();
    const callbacks = new Map();
    let source = null;
    let mediaTime = 0;
    const video = {
      readyState: 0,
      paused: true,
      ended: false,
      seeking: false,
      error: null,
      seeks: [],
      plays: [],
      get src() {
        return source;
      },
      set src(value) {
        source = value;
      },
      get currentTime() {
        return mediaTime;
      },
      set currentTime(value) {
        mediaTime = value;
        video.seeking = true;
        video.ended = false;
        video.readyState = readiness.HAVE_METADATA;
        video.seeks.push({ time: wallTime, to: value });
        video.emit('seeking');
      },
      getAttribute: () => source,
      load() {
        video.readyState = 0;
      },
      play() {
        video.paused = false;
        video.plays.push(wallTime);
        video.emit('playing');
        return Promise.resolve();
      },
      pause() {
        video.paused = true;
        video.emit('pause');
      },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
      emit(name) {
        for (const callback of [...(listeners.get(name) ?? [])]) callback();
      },
      decode(time = mediaTime) {
        mediaTime = time;
        video.seeking = false;
        video.readyState = readiness.HAVE_CURRENT_DATA;
        video.emit('loadeddata');
        video.emit('seeked');
      },
      requestVideoFrameCallback(callback) {
        const id = ++handle;
        callbacks.set(id, callback);
        return id;
      },
      cancelVideoFrameCallback(id) {
        callbacks.delete(id);
      },
      frame(time, now, displayDelay = 0) {
        mediaTime = time;
        wallTime = now;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending)
          callback(now, { mediaTime: time, expectedDisplayTime: now + displayDelay });
      },
      listenerCount() {
        return [...listeners.values()].reduce((sum, values) => sum + values.size, 0);
      },
    };
    return video;
  };
  const first = makeVideo();
  const second = makeVideo();
  const load = moduleLoader(
    {
      react: { ...harness.react, useEffectEvent: (callback) => callback },
      'react-dom': {
        flushSync: (callback) => {
          callback();
          render();
        },
      },
    },
    {
      HTMLMediaElement: readiness,
      document,
      requestAnimationFrame: (callback) => {
        const id = ++handle;
        paints.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => paints.delete(id),
    },
  );
  const { useLemurVideo } = load('@/hooks/use-lemur-video');
  function render() {
    player = harness.render(() => useLemurVideo(options));
    return player;
  }
  render();
  player.firstRef.current = first;
  player.secondRef.current = second;
  player.start();
  render();
  first.decode();
  render();
  second.decode();
  render();

  return {
    first,
    second,
    document,
    get player() {
      return player;
    },
    update(changes) {
      options = { ...options, ...changes };
      render();
    },
    paint(now) {
      wallTime = now;
      const pending = [...paints.values()];
      paints.clear();
      for (const callback of pending) callback(now);
      render();
    },
    hide() {
      document.hidden = true;
      documentEvents.get('visibilitychange')?.();
    },
    async unmount() {
      await settle();
      harness.unmount();
      assert.equal(paints.size, 0);
      assert.equal(first.listenerCount(), 0);
      assert.equal(second.listenerCount(), 0);
    },
  };
}

function firstWarmFrames(outgoing, incoming) {
  incoming.frame(0, 1000);
  outgoing.frame(timing.duration + frameTime, 1020);
  incoming.frame(frameTime, 1020);
}

for (const rate of [1, 0.5]) {
  for (const displayDelay of [0, 1000 / timing.fps, 2000 / timing.fps]) {
    test(`Overlap сохраняет видимые кадры при cold-start: ${rate}x, compositor +${displayDelay}`, async () => {
      const fixture = playerFixture(rate);
      fixture.first.frame(timing.duration - frameTime, 1000, displayDelay);
      fixture.paint(1000);
      assert.equal(fixture.second.plays.length, 0);
      fixture.first.frame(timing.duration, 1000 + (1000 * frameTime) / rate, displayDelay);
      fixture.paint(1000 + (1000 * frameTime) / rate);
      assert.equal(fixture.second.paused, false, 'Декодер запускается в скрытом слоте');
      assert.equal(fixture.player.activeSlot, 0, 'До реального кадра виден непрерывный overlap');
      // Холодный decoder пропустил первые два кадра, но они видны из старого слота.
      fixture.first.frame(timing.duration + frameTime, 1040, displayDelay);
      fixture.first.frame(timing.duration + 2 * frameTime, 1060, displayDelay);
      assert.equal(fixture.player.activeSlot, 0);
      fixture.first.frame(timing.duration + 3 * frameTime, 1080, displayDelay);
      fixture.second.frame(3 * frameTime, 1080, displayDelay);
      assert.equal(
        fixture.player.activeSlot,
        0,
        'Первый cold-start RVFC ещё не гарантирует cadence',
      );
      fixture.first.frame(timing.duration + 4 * frameTime, 1100, displayDelay);
      fixture.second.frame(4 * frameTime, 1100, displayDelay);
      assert.equal(fixture.player.activeSlot, 0, 'Первый advancing кадр остаётся скрытым');
      fixture.first.frame(timing.duration + 5 * frameTime, 1120, displayDelay);
      fixture.second.frame(5 * frameTime, 1120, displayDelay);
      assert.equal(fixture.player.activeSlot, 1);
      assert.equal(fixture.player.ref.current, fixture.second);
      assert.equal(fixture.second.paused, false);
      assert.equal(fixture.second.plays.length, 1, 'Готовый decoder не перезапускается при reveal');
      assert.equal(fixture.second.seeks.length, 0, 'Видимый слот не должен ждать decoder seek');
      assert.equal(fixture.first.seeking, true, 'Медленный rewind скрыт за другим слотом');
      assert.equal(fixture.first.paused, true);
      await fixture.unmount();
    });
  }
}

test('Пауза и скрытая вкладка отменяют уже назначенную передачу кадра', async () => {
  for (const stop of [(fixture) => fixture.update({ paused: true }), (fixture) => fixture.hide()]) {
    const fixture = playerFixture();
    fixture.first.frame(timing.duration - frameTime, 1000);
    stop(fixture);
    fixture.paint(1000 + frameTime * 1000);
    assert.equal(fixture.player.activeSlot, 0);
    assert.equal(fixture.second.plays.length, 0);
    await fixture.unmount();
  }
});

test('Сердечко забирает подготовленный слот до границы idle', async () => {
  const fixture = playerFixture();
  fixture.first.frame(timing.duration - frameTime, 1000);
  fixture.update({ prepared: { source: 'heart-phase-00.mp4' } });
  fixture.paint(1000 + frameTime * 1000);
  assert.equal(fixture.player.activeSlot, 0);
  assert.equal(fixture.second.src, 'heart-phase-00.mp4');
  assert.equal(fixture.second.plays.length, 0);
  assert.equal(fixture.first.loop, false, 'Расширенный файл нельзя зациклить нативно');
  await fixture.unmount();
});

test('Без RVFC готовый нулевой слот не отбрасывает фазу конца overlap', async () => {
  const fixture = playerFixture();
  fixture.first.ended = true;
  fixture.first.paused = true;
  fixture.first.emit('ended');
  fixture.paint(1000);
  assert.equal(fixture.player.activeSlot, 0);
  assert.equal(fixture.first.currentTime, timing.overlap);
  assert.equal(fixture.first.paused, false);
  assert.equal(fixture.second.paused, true);
  await fixture.unmount();
});

test('Неуспевший prewarm допускает обычный rewind, а не вечную остановку', async () => {
  const fixture = playerFixture();
  fixture.second.readyState = readiness.HAVE_METADATA;
  fixture.first.ended = true;
  fixture.first.paused = true;
  fixture.first.emit('ended');
  assert.equal(fixture.first.currentTime, timing.overlap);
  assert.equal(fixture.first.seeking, true);
  assert.equal(fixture.first.paused, false);
  await fixture.unmount();
});

for (const interrupt of ['pause', 'hidden', 'reaction']) {
  test(`Уже играющий скрытый overlap останавливается при ${interrupt}`, async () => {
    const fixture = playerFixture();
    fixture.first.frame(timing.duration, 1000);
    fixture.paint(1000);
    assert.equal(fixture.second.paused, false);
    if (interrupt === 'pause') fixture.update({ paused: true });
    if (interrupt === 'hidden') fixture.hide();
    if (interrupt === 'reaction') fixture.update({ prepared: { source: 'heart-phase-00.mp4' } });
    assert.equal(fixture.second.paused, true);
    fixture.first.frame(timing.duration + 3 * frameTime, 1100);
    fixture.second.frame(3 * frameTime, 1100);
    fixture.paint(1100);
    assert.equal(fixture.player.activeSlot, 0, 'Отменённый RVFC не должен забрать слот');
    await fixture.unmount();
  });
}

test('Расходящийся decoder остаётся скрытым до совпадения фаз', async () => {
  const fixture = playerFixture();
  fixture.first.frame(timing.duration, 1000);
  fixture.paint(1000);
  firstWarmFrames(fixture.first, fixture.second);
  fixture.first.frame(timing.duration + 3 * frameTime, 1050);
  fixture.second.frame(4 * frameTime, 1050);
  fixture.paint(1050);
  assert.equal(fixture.player.activeSlot, 0);
  assert.ok(fixture.second.playbackRate < 1, 'Только скрытый decoder догоняет фазу');
  assert.equal(fixture.first.playbackRate, 1);
  fixture.first.frame(timing.duration + 4 * frameTime, 1070);
  fixture.second.frame(4 * frameTime, 1070);
  assert.equal(fixture.player.activeSlot, 0, 'Смена rate требует скрытой стабилизации');
  fixture.first.frame(timing.duration + 5 * frameTime, 1090);
  fixture.second.frame(5 * frameTime, 1090);
  assert.equal(fixture.player.activeSlot, 0);
  fixture.first.frame(timing.duration + 6 * frameTime, 1110);
  fixture.second.frame(6 * frameTime, 1110);
  assert.equal(fixture.player.activeSlot, 1);
  assert.equal(fixture.second.playbackRate, 1);
  await fixture.unmount();
});

test('Queued reaction на конце расширенного файла сохраняет фазу overlap', async () => {
  const fixture = playerFixture();
  fixture.update({ prepared: { source: 'heart-phase-00.mp4' } });
  fixture.first.ended = true;
  fixture.first.paused = true;
  fixture.first.emit('ended');
  assert.equal(fixture.first.currentTime, timing.overlap);
  assert.equal(fixture.first.paused, false);
  assert.equal(fixture.player.activeSlot, 0);
  await fixture.unmount();
});

test('После возврата из реакции loop сохраняет логический startAt без нового seek', async () => {
  const fixture = playerFixture();
  const returnAt = (motion.reactionEnd + motion.reactionPhaseStep) % timing.duration;
  fixture.update({ startAt: returnAt });
  fixture.second.decode(returnAt);
  fixture.paint(100);
  fixture.first.decode(0);
  fixture.paint(200);
  assert.equal(fixture.player.activeSlot, 1);
  fixture.second.frame(timing.duration, 1000);
  fixture.paint(1000);
  firstWarmFrames(fixture.second, fixture.first);
  fixture.second.frame(timing.duration + 3 * frameTime, 1050);
  fixture.first.frame(3 * frameTime, 1050);
  assert.equal(fixture.player.activeSlot, 0);
  assert.equal(fixture.player.ready, true);
  const seeks = fixture.first.seeks.length;
  fixture.update({ paused: true });
  assert.equal(fixture.player.ready, true);
  assert.equal(fixture.first.seeks.length, seeks);
  assert.equal(fixture.first.currentTime, 3 * frameTime);
  await fixture.unmount();
});

test('На половинной скорости одинаковая фаза с поздним RVFC ещё не готова к reveal', async () => {
  const fixture = playerFixture(0.5);
  fixture.first.frame(timing.duration, 1000);
  fixture.paint(1000);
  firstWarmFrames(fixture.first, fixture.second);
  const phase = 3 * frameTime;
  fixture.first.frame(timing.duration + phase, 1040);
  fixture.second.frame(phase, 1040 + 1000 / timing.fps);
  fixture.paint(1060);
  assert.equal(fixture.player.activeSlot, 0, 'Одинаковый кадр на соседнем vsync продлит удержание');
  assert.ok(fixture.second.playbackRate > 0.5, 'Скрытый decoder должен догнать время кадра');
  fixture.first.frame(timing.duration + 2 * phase, 1100);
  fixture.second.frame(2 * phase, 1100);
  assert.equal(fixture.player.activeSlot, 0);
  fixture.first.frame(timing.duration + 3 * phase, 1133);
  fixture.second.frame(3 * phase, 1133);
  assert.equal(fixture.player.activeSlot, 0);
  fixture.first.frame(timing.duration + 4 * phase, 1166);
  fixture.second.frame(4 * phase, 1166);
  assert.equal(fixture.player.activeSlot, 1);
  assert.equal(fixture.second.playbackRate, 0.5);
  await fixture.unmount();
});

test('Ошибка запуска скрытого decoder не останавливает видимый overlap', async () => {
  const fixture = playerFixture();
  fixture.second.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  fixture.first.frame(timing.duration, 1000);
  fixture.paint(1000);
  await settle();
  assert.equal(fixture.player.activeSlot, 0);
  assert.equal(fixture.first.paused, false);
  fixture.first.ended = true;
  fixture.first.emit('ended');
  assert.equal(fixture.first.currentTime, timing.overlap);
  assert.equal(fixture.player.error, '');
  await fixture.unmount();
});

test('Порядок RVFC не меняет готовность двух кадров в одном vsync', async () => {
  const fixture = playerFixture();
  fixture.first.frame(timing.duration, 1000);
  fixture.paint(1000);
  firstWarmFrames(fixture.first, fixture.second);
  const phase = 3 * frameTime;
  fixture.second.frame(phase, 1050);
  assert.equal(fixture.player.activeSlot, 0);
  fixture.first.frame(timing.duration + phase, 1050);
  assert.equal(fixture.player.activeSlot, 1, 'Сопоставление нужно и после outgoing callback');
  assert.equal(fixture.second.plays.length, 1);
  await fixture.unmount();
});
