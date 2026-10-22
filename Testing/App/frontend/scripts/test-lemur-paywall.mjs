import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { preparePaywallEyes, renderPaywallEyes } from '../src/lib/lemur-paywall-eyes.mjs';
import { paywallFace, paywallGesture } from '../src/lib/lemur-paywall-motion.mjs';
import { paywallBodyBasis, paywallBodyPose } from '../src/lib/lemur-paywall-body.mjs';

const config = JSON.parse(
  await readFile(new URL('../src/config/lemur-paywall-motion.json', import.meta.url), 'utf8'),
);
const { data, info } = await sharp(config.source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const clean = await sharp(config.eyeCleanPlate).ensureAlpha().raw().toBuffer();
const eyes = preparePaywallEyes(clean, info, config);
const offset = (x, y) => (y * info.width + x) * info.channels;
function render(pose) {
  const result = Buffer.from(data);
  renderPaywallEyes(result, data, clean, eyes, pose, config);
  return result;
}

test('Начальная мимика сохраняет утверждённый рисунок побайтно', () => {
  assert.deepEqual(render({ gaze: 0, blink: 0 }), data);
});

test('Моргание не создаёт выступов на внешней границе масок', () => {
  const closed = render({ gaze: 0, blink: 1 });
  for (const [x, y] of [
    [946, 509],
    [1178, 472],
    [1330, 433],
  ]) {
    const index = offset(x, y);
    assert.deepEqual(
      closed.subarray(index, index + info.channels),
      data.subarray(index, index + info.channels),
    );
  }
});

test('Взгляд в зрителя показывает полный зрачок без старого блика', () => {
  const looking = render({ gaze: 1, blink: 0 });
  for (const eye of config.face.eyes) {
    const [px, py, , ry] = eye.pupil;
    const cx = px + eye.gaze[0];
    const cy = py + eye.gaze[1];
    const bottom = offset(Math.round(cx), Math.round(cy + ry * 0.85));
    assert.ok(looking[bottom] < 30, 'Низ зрачка не должен обрезаться исходным краем глаза');
    const oldShine = offset(Math.round(px + eye.shine[0]), Math.round(py + eye.shine[1]));
    assert.ok(looking[oldShine + 2] < 100, 'Старый белый блик должен исчезнуть');
  }
});

test('Закрытое веко прячет зрачки и блики', () => {
  const closed = render({ gaze: 1, blink: 1 });
  for (const eye of eyes) {
    for (const pixel of eye.pixels) {
      assert.ok(closed[pixel.offset] < 100);
      assert.ok(closed[pixel.offset + 1] < 100);
    }
  }
});

test('Жест повторяется без изменения, мимика замыкается', () => {
  assert.equal(paywallGesture(1.16, config), paywallGesture(5.16, config));
  assert.deepEqual(paywallFace(0, config), paywallFace(config.duration, config));
  assert.equal(paywallGesture(0, config), paywallGesture(config.duration, config));
});

test('Дыхание оставляет таз, локоть, стопы и тень на месте', () => {
  for (const [x, y] of [
    [700, 770],
    [1250, 760],
    [420, 775],
    [800, 780],
  ]) {
    assert.ok(paywallBodyBasis(x, y, config).every((value) => value === 0));
  }
  assert.ok(paywallBodyBasis(760, 600, config)[1] < 0);
});

test('Дыхание и хвост замыкаются без скачка положения или скорости', () => {
  const epsilon = 0.0001;
  const start = paywallBodyPose(0, config);
  const end = paywallBodyPose(config.duration, config);
  const after = paywallBodyPose(epsilon, config);
  const before = paywallBodyPose(config.duration - epsilon, config);
  for (const channel of Object.keys(start)) {
    assert.ok(Math.abs(start[channel] - end[channel]) < 1e-10);
    assert.ok(
      Math.abs(
        (after[channel] - start[channel]) / epsilon - (end[channel] - before[channel]) / epsilon,
      ) < 0.001,
    );
  }
});
