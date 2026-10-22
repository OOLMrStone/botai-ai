import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

import { lemurHangSvg } from '../src/lib/lemur-hang-svg.mjs';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const qa = await readJson('src/config/lemur-hang-qa.json');
const limits = qa.limbStability;

async function rejectedRenderer() {
  const original = await readFile(new URL(qa.paths.rejectedLimbsRenderer, root), 'utf8');
  const imports = new URL(qa.paths.rendererImportRoot, root);
  const source = original.replace(
    /from (['"])(\.\/[^'"]+)\1/g,
    (_, quote, path) => `from ${quote}${new URL(path, imports).href}${quote}`,
  );

  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .lemurHangSvg;
}

async function visiblePaws(svg, art, color) {
  const scale = limits.rasterScale;
  const [left, top, width, height] = art.viewBox;
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(width * scale, height * scale)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = color.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16));

  return limits.crops.map((crop) => {
    const points = [];
    for (let y = (crop.y - top) * scale; y < (crop.y + crop.height - top) * scale; y++) {
      for (let x = (crop.x - left) * scale; x < (crop.x + crop.width - left) * scale; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (
          data[offset + 3] >= limits.alphaThreshold &&
          rgb.every(
            (channel, index) => Math.abs(data[offset + index] - channel) <= limits.colorTolerance,
          )
        )
          points.push([x, y]);
      }
    }
    assert.ok(
      points.length / scale ** 2 >= limits.minimumArea,
      `${crop.name}: стопа исчезла из окна`,
    );

    return {
      points,
      pixels: new Set(points.map(([x, y]) => y * info.width + x)),
      width: info.width,
    };
  });
}

function outsideTolerance(actual, reference) {
  const radius = limits.maximumTravel * limits.rasterScale;
  const neighbors = [];
  for (let y = -Math.ceil(radius); y <= Math.ceil(radius); y++) {
    for (let x = -Math.ceil(radius); x <= Math.ceil(radius); x++) {
      if (Math.hypot(x, y) <= radius) neighbors.push(y * reference.width + x);
    }
  }

  return actual.points.filter(
    ([x, y]) => !neighbors.some((delta) => reference.pixels.has(y * reference.width + x + delta)),
  ).length;
}

async function measure(artPath, motionPath, render) {
  const [art, motion] = await Promise.all([readJson(artPath), readJson(motionPath)]);
  const base = await readJson(motion.paths.baseArt);
  const isolated = { ...motion, mode: 'idle', swingDegrees: 0, headFollow: 0 };
  const reference = await visiblePaws(render(0, art, isolated, base), art, base.colors.paw);
  const worst = limits.crops.map(() => 0);

  for (let frame = 1; frame < limits.samples; frame++) {
    const time = (frame * motion.duration) / limits.samples;
    const actual = await visiblePaws(render(time, art, isolated, base), art, base.colors.paw);
    for (const [index, paw] of actual.entries()) {
      worst[index] = Math.max(
        worst[index],
        outsideTolerance(paw, reference[index]),
        outsideTolerance(reference[index], paw),
      );
    }
  }

  return worst;
}

test('Видимые задние стопы v8 не перемещаются независимо от общего качания', async (context) => {
  const movement = await measure(qa.paths.currentArt, qa.paths.currentMotion, lemurHangSvg);
  for (const [index, pixels] of movement.entries()) {
    assert.equal(
      pixels,
      0,
      `${limits.crops[index].name}: ${pixels} пикселей вышли за допуск ${limits.maximumTravel}`,
    );
  }
  context.diagnostic(
    `Обе растровые маски остаются в пределах ${limits.maximumTravel} единиц во всех ${limits.samples} фазах`,
  );
});

test('Та же проверка обнаруживает поджимание обеих задних стоп отвергнутой v7', async (context) => {
  const movement = await measure(
    qa.paths.rejectedLimbsArt,
    qa.paths.rejectedLimbsMotion,
    await rejectedRenderer(),
  );
  for (const [index, pixels] of movement.entries()) {
    assert.ok(pixels > 0, `${limits.crops[index].name}: прежнее перемещение не обнаружено`);
  }
  context.diagnostic(`Пиксели вне разрешённого коридора v7: ${movement.join(', ')}`);
});
