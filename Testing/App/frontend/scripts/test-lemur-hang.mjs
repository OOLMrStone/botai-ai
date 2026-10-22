import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { lemurHangSvg } from '../src/lib/lemur-hang-svg.mjs';

const read = async (name) =>
  JSON.parse(await readFile(new URL(`../src/config/${name}.json`, import.meta.url), 'utf8'));
const art = await read('lemur-hang-art');
const motion = await read('lemur-hang-motion');
const base = await read('lemur-joy-art');
const draw = (time, mode = 'idle') => lemurHangSvg(time, art, { ...motion, mode }, base);

test('Крайние позы совпадают на границе цикла', () => {
  for (const mode of ['idle', 'heart']) assert.equal(draw(0, mode), draw(motion.duration, mode));
});

test('Быстрое сердечко входит и выходит из текущей позы без скачка', () => {
  for (let index = 0; index < motion.duration / motion.reactionPhaseStep; index++) {
    const offset = index * motion.reactionPhaseStep;
    for (const time of [0, motion.reactionEnd]) {
      const reaction = lemurHangSvg(
        time,
        art,
        {
          ...motion,
          mode: 'heart',
          bodyOffset: offset,
        },
        base,
      );
      const idle = lemurHangSvg(
        time + offset,
        art,
        {
          ...motion,
          mode: 'idle',
        },
        base,
      );
      assert.equal(reaction, idle, `Фаза ${index}, время ${time}`);
    }
  }
});

test('Крепление горизонтально и неподвижно в цикле и во всех фазах сердечка', async () => {
  const band = async (time, offset = 0, mode = 'idle') =>
    sharp(Buffer.from(lemurHangSvg(time, art, { ...motion, bodyOffset: offset, mode }, base)))
      .resize(motion.viewSize, motion.viewSize)
      .ensureAlpha()
      .extract({
        left: 0,
        top: 0,
        width: motion.viewSize,
        height: Math.floor(-art.viewBox[1] + art.tail.bendRange[0] / 2),
      })
      .raw()
      .toBuffer();
  const reference = await band(0);
  for (const time of motion.qaTimes) {
    const actual = await band(time);
    assert.ok(actual.every((value, index) => Math.abs(value - reference[index]) <= 1));
  }
  for (let phase = 0; phase < Math.round(motion.duration / motion.reactionPhaseStep); phase++) {
    for (const time of [0, motion.reactionEnd / 2, motion.reactionEnd]) {
      const actual = await band(time, phase * motion.reactionPhaseStep, 'heart');
      assert.ok(actual.every((value, index) => Math.abs(value - reference[index]) <= 1));
    }
  }
});

test('Фон и пространство под лапами прозрачны, наземной тени нет', async () => {
  for (const time of motion.qaTimes) {
    const { data, info } = await sharp(Buffer.from(draw(time, 'heart')))
      .resize(motion.viewSize, motion.viewSize)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const emptyFrom = Math.ceil(
      Math.max(...art.arms.map((arm) => arm.end[1] + Math.max(...arm.paw))) +
        art.tail.radii[0] -
        art.viewBox[1],
    );
    for (let y = emptyFrom; y < info.height; y++)
      for (let x = 0; x < info.width; x++) assert.equal(data[(y * info.width + x) * 4 + 3], 0);
  }
});
