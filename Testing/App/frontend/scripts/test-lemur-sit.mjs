import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { lemurSitSvg } from '../src/lib/lemur-sit-svg.mjs';
import { sitPose } from '../src/lib/lemur-sit-motion.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const art = await read('../src/config/lemur-sit-art.json');
const motion = await read('../src/config/lemur-sit-motion.json');
const base = await read('../src/config/lemur-joy-art.json');
const settings = await read('../src/config/lemur-export.json');
const qa = await read('../src/config/lemur-sit-qa.json');
const root = resolve(import.meta.dirname, '..');
const exportConfig = settings.animations.sit;

function hasWhiteGap(pixels, junction, time) {
  const scale = art.size / art.viewBox[2];
  const offset = junction.followsHead ? sitPose(time, motion).headY : 0;

  return junction.points.some(([x, y]) => {
    const column = Math.round((x - art.viewBox[0]) * scale);
    const row = Math.round((y + offset - art.viewBox[1]) * scale);
    const index = (row * art.size + column) * settings.channels;

    return pixels
      .subarray(index, index + settings.channels)
      .every((value) => value > qa.whiteThreshold);
  });
}

test('Опора таза и стыки лапы и уха сохраняются во всех кадрах; прежние дефекты отвергаются', async () => {
  for (const junction of qa.junctions) {
    const previous = await sharp(resolve(root, junction.rejectedPoster ?? qa.rejectedPoster))
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.ok(hasWhiteGap(previous, junction, 0), junction.name);
  }

  for (let index = 0; index < motion.fps * motion.duration; index++) {
    const frame = resolve(
      root,
      motion.paths.work,
      `${String(index).padStart(settings.frameDigits, '0')}.png`,
    );
    const pixels = await sharp(frame).removeAlpha().raw().toBuffer();

    for (const junction of qa.junctions) {
      assert.equal(
        hasWhiteGap(pixels, junction, index / motion.fps),
        false,
        `${junction.name}, ${index}`,
      );
    }
  }
});

function bitmapRegion([x, y, width, height]) {
  const scale = art.size / art.viewBox[2];

  return {
    left: Math.floor((x - art.viewBox[0]) * scale),
    top: Math.floor((y - art.viewBox[1]) * scale),
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
  };
}

test('Сидение замыкается с непрерывными положением и скоростью', () => {
  const epsilon = 0.0001;
  const before = sitPose(motion.duration - epsilon, motion);
  const start = sitPose(0, motion);
  const after = sitPose(epsilon, motion);

  assert.deepEqual(start, sitPose(motion.duration, motion));
  for (const name of Object.keys(start)) {
    assert.ok(
      Math.abs((after[name] - start[name]) / epsilon - (start[name] - before[name]) / epsilon) <
        0.002,
      name,
    );
  }
});

test('Каждая настоящая подошва касается общего пола', async () => {
  for (const foot of art.feet) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="${art.viewBox.join(' ')}"><path fill="black" d="${foot}"/></svg>`;
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bottom = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels + info.channels - 1] > 16) bottom = y;
      }
    }
    assert.equal(bottom, art.floor - art.viewBox[1] - 1);
  }
});

test('В закрытых глазах нет янтарной щели', async () => {
  for (const time of motion.qaTimes.filter((t) => sitPose(t, motion).blink === 1)) {
    const svg = Buffer.from(lemurSitSvg(time, art, motion, base));
    for (const eye of art.head.eyes) {
      const bounds = [...eye.bounds];
      bounds[1] += sitPose(time, motion).headY;
      const pixels = await sharp(svg).extract(bitmapRegion(bounds)).removeAlpha().raw().toBuffer();
      let amber = 0;
      for (let i = 0; i < pixels.length; i += 3) {
        if (pixels[i] > 220 && pixels[i + 1] > 130 && pixels[i + 1] < 225 && pixels[i + 2] < 110)
          amber++;
      }
      assert.equal(amber, 0, `${eye.name} at ${time}`);
    }
  }
});

test('Тень видна и неподвижна во всех экспортированных кадрах', async () => {
  const { x, y, width, height } = art.shadow;
  const region = bitmapRegion([x, y + 1, width, height]);
  let reference;
  for (let i = 0; i < motion.fps * motion.duration; i++) {
    const frame = resolve(
      root,
      motion.paths.work,
      `${String(i).padStart(settings.frameDigits, '0')}.png`,
    );
    const pixels = await sharp(frame).extract(region).removeAlpha().raw().toBuffer();
    if (reference) assert.ok(pixels.equals(reference), `shadow changed at frame ${i}`);
    else {
      reference = pixels;
      assert.ok(pixels.some((value) => value < 240));
    }
  }
});

test('Левый мастер точно зеркален и сохраняет тайминг', async () => {
  const right = resolve(root, motion.paths.output, exportConfig.master);
  const mirror = exportConfig.mirrors[0];
  const left = resolve(root, mirror.output, mirror.master);
  const metadata = await sharp(right, {
    animated: true,
    limitInputPixels: art.size * art.size * motion.fps * motion.duration,
  }).metadata();
  const mirrored = await sharp(left, {
    animated: true,
    limitInputPixels: art.size * art.size * motion.fps * motion.duration,
  }).metadata();

  assert.equal(metadata.pages, motion.fps * motion.duration);
  assert.equal(mirrored.pages, metadata.pages);
  assert.deepEqual(mirrored.delay, metadata.delay);
  for (const time of motion.qaTimes) {
    const page = Math.round(time * motion.fps);
    const original = await sharp(right, { page }).flop().removeAlpha().raw().toBuffer();
    const reflected = await sharp(left, { page }).removeAlpha().raw().toBuffer();
    assert.ok(original.equals(reflected), `mirror differs at frame ${page}`);
  }
});
