import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sharp from 'sharp';
import { cryPose, cryWater, cryHighlight } from '../src/lib/lemur-cry-motion.mjs';
import { lemurCrySvg } from '../src/lib/lemur-cry-svg.mjs';

function readConfig(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const motion = readConfig('src/config/lemur-cry-motion.json');
const qa = readConfig('src/config/lemur-cry-qa.json');
const art = readConfig(motion.paths.art);
const base = readConfig(motion.paths.baseArt);
const rejectedVersion = ['v1', 'v4', 'v5'].find((version) =>
  process.argv.includes(`--rejected-${version}`),
);
const rejected = Boolean(rejectedVersion);
const rejectedPaths = {
  v1: qa.regression.rejectedPaths,
  v4: qa.regression.compactRejectedPaths,
  v5: qa.regression.faceRejectedPaths,
}[rejectedVersion];
const regressionDraw = rejected
  ? (await import(new URL(`../${rejectedPaths.svg}`, import.meta.url))).lemurCrySvg
  : lemurCrySvg;
const regressionModel = rejected
  ? [
      readConfig(rejectedPaths.art),
      readConfig(rejectedPaths.motion),
      readConfig(rejectedPaths.base),
    ]
  : [art, motion, base];

function near(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), label);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} / ${expected}`);
}

test('Стык цикла сохраняет положение и односторонние скорости головы, хвоста и воды', () => {
  const first = cryPose(0, motion);
  const last = cryPose(motion.duration, motion);
  const before = cryPose(motion.duration - qa.step, motion);
  const after = cryPose(qa.step, motion);

  for (const field of qa.loopFields) {
    near(first[field], last[field], qa.positionTolerance, `Положение ${field}`);
    near(before[field], after[field], qa.positionTolerance, `Окрестность стыка ${field}`);
    near(
      (last[field] - before[field]) / qa.step,
      (after[field] - first[field]) / qa.step,
      qa.velocityTolerance,
      `Скорость ${field}`,
    );
  }
});

test('Все ключи движения непрерывны по позе и скорости', () => {
  const times = new Set(Object.values(motion.channels).flatMap((keys) => keys.map(([t]) => t)));

  for (const time of times) {
    const before = cryPose(time - qa.step, motion);
    const at = cryPose(time, motion);
    const after = cryPose(time + qa.step, motion);

    for (const field of Object.keys(at)) {
      near(before[field], at[field], qa.positionTolerance, `${field} до ключа ${time}`);
      near(after[field], at[field], qa.positionTolerance, `${field} после ключа ${time}`);
      near(
        (at[field] - before[field]) / qa.step,
        (after[field] - at[field]) / qa.step,
        qa.velocityTolerance,
        `Скорость ${field} в ключе ${time}`,
      );
    }
  }
});

async function lowerContours(time) {
  const { size, lowerStart, inkThreshold, regions } = qa.raster;
  const top = Math.floor(size * lowerStart);
  const { data, info } = await sharp(Buffer.from(lemurCrySvg(time, art, motion, base)))
    .resize(size, size)
    .extract({ left: 0, top, width: size, height: size - top })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return regions.map(({ name, range }) => {
    const contour = [];
    for (let x = Math.ceil(range[0] * size); x < Math.floor(range[1] * size); x++) {
      let bottom = -1;
      for (let y = info.height - 1; y >= 0; y--) {
        const offset = (y * info.width + x) * info.channels;
        if (Math.max(...data.subarray(offset, offset + info.channels)) < inkThreshold) {
          bottom = y + top;
          break;
        }
      }
      contour.push(bottom);
    }
    assert.ok(
      contour.every((y) => y >= top),
      `Не найден реальный контур: ${name}, t=${time}`,
    );

    return contour;
  });
}

test('Растровые нижние контуры обеих стоп и тела закреплены во всех экспортируемых кадрах', async () => {
  const baseline = await lowerContours(0);

  for (let frame = 1; frame < motion.fps * motion.duration; frame++) {
    const time = frame / motion.fps;
    const actual = await lowerContours(time);

    actual.forEach((contour, index) => {
      assert.deepEqual(contour, baseline[index], `${qa.raster.regions[index].name}, t=${time}`);
    });
  }
});

async function regressionRaster(time) {
  return sharp(Buffer.from(regressionDraw(time, ...regressionModel)))
    .resize(qa.regression.size, qa.regression.size)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function colorAt(raster, x, y) {
  const offset = (y * raster.info.width + x) * raster.info.channels;

  return raster.data.subarray(offset, offset + raster.info.channels);
}

function isBlue([red, green, blue]) {
  const threshold = qa.regression.blue;

  return blue > red + threshold.redDifference && green > red + threshold.greenDifference;
}

function isAmber([red, green, blue]) {
  const threshold = qa.regression.amber;

  return (
    red > threshold.redMin &&
    green > threshold.greenMin &&
    green < threshold.greenMax &&
    blue < threshold.blueMax
  );
}

function isSubmergedIris([red, green, blue]) {
  const threshold = qa.regression.submergedIris;

  return (
    red > threshold.redMin &&
    green - red > threshold.greenDifferenceMin &&
    blue - red > threshold.blueDifferenceMin &&
    blue - red < threshold.blueDifferenceMax
  );
}

test('Под чашами слёз не остаётся янтарная полоска радужки', async () => {
  for (const time of new Set([qa.regression.dropTime, ...motion.qaTimes])) {
    const raster = await regressionRaster(time);

    for (const eye of qa.regression.eyes) {
      let amberBelowWater = 0;
      let bluePixels = 0;
      for (let x = eye.left; x < eye.right; x++) {
        let seenWater = false;
        for (let y = eye.top; y < eye.bottom; y++) {
          const pixel = colorAt(raster, x, y);
          if (isBlue(pixel)) {
            seenWater = true;
            bluePixels++;
          } else if (seenWater && isAmber(pixel)) {
            amberBelowWater++;
          }
        }
      }
      assert.ok(bluePixels > qa.regression.minimumBowlArea, `Нет чаши слёз: ${eye.name}`);
      assert.equal(amberBelowWater, 0, `${eye.name}, t=${time}: янтарь ниже воды`);
    }
  }
});

function colorComponents(raster, matches, region) {
  const { width, height } = raster.info;
  const visited = new Uint8Array(width * height);
  const components = [];
  const bounds = region ?? { left: 0, right: width, top: 0, bottom: height };
  const contains = (x, y) =>
    x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;

  for (let start = 0; start < visited.length; start++) {
    const sx = start % width;
    const sy = Math.floor(start / width);
    if (visited[start] || !contains(sx, sy) || !matches(colorAt(raster, sx, sy))) {
      continue;
    }
    visited[start] = 1;
    const queue = [start];
    const component = { left: sx, right: sx, top: sy, bottom: sy };
    let sumX = 0;
    let sumY = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const x = queue[cursor] % width;
      const y = Math.floor(queue[cursor] / width);
      sumX += x;
      sumY += y;
      component.left = Math.min(component.left, x);
      component.right = Math.max(component.right, x);
      component.top = Math.min(component.top, y);
      component.bottom = Math.max(component.bottom, y);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (!contains(nx, ny)) continue;
        const next = ny * width + nx;
        if (!visited[next] && matches(colorAt(raster, nx, ny))) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    if (queue.length > qa.regression.minimumComponentArea) {
      components.push({
        ...component,
        area: queue.length,
        centerX: sumX / queue.length,
        centerY: sumY / queue.length,
      });
    }
  }

  return components;
}

test('На лице только две цельные чаши слёз, отдельных голубых капель нет', async () => {
  for (const time of new Set([qa.regression.dropTime, ...motion.qaTimes])) {
    const components = colorComponents(await regressionRaster(time), isBlue);

    assert.equal(
      components.length,
      qa.regression.eyes.length,
      `Отдельная капля, t=${time}: ${components.map(({ area }) => area)}`,
    );
    assert.ok(
      components.every(({ area }) => area > qa.regression.minimumBowlArea),
      `Чаша распалась, t=${time}`,
    );
    for (const component of components) {
      assert.ok(
        qa.regression.eyes.some(
          (eye) =>
            component.left > eye.left &&
            component.right < eye.right &&
            component.top > eye.top &&
            component.bottom < eye.bottom,
        ),
        `Область проверки обрезает чашу слёз, t=${time}`,
      );
    }
  }
});

function pupilMetrics(raster, eye) {
  const pupils = colorComponents(
    raster,
    (pixel) => Math.max(...pixel) < qa.regression.gaze.pupilChannelMax,
    eye,
  );
  const pupil = pupils.sort((a, b) => b.area - a.area)[0];
  const iris = colorComponents(
    raster,
    (pixel) => isAmber(pixel) || isSubmergedIris(pixel),
    eye,
  ).sort((a, b) => b.area - a.area)[0];
  assert.ok(pupil && iris, `Не найден зрачок или радужка: ${eye.name}`);
  const width = pupil.right - pupil.left;
  const height = pupil.bottom - pupil.top;
  const irisWidth = iris.right - iris.left;
  const irisHeight = iris.bottom - iris.top;

  return {
    width,
    height,
    widthRatio: width / irisWidth,
    centerX: (pupil.left + pupil.right - iris.left - iris.right) / (2 * irisWidth),
    centerY: (pupil.top + pupil.bottom - iris.top - iris.bottom) / (2 * irisHeight),
  };
}

test('Крупные зрачки центрированы в глазах, их видимые размеры равны', async () => {
  const limits = qa.regression.gaze;

  for (const time of motion.qaTimes) {
    if (cryPose(time, motion).eyeOpen < qa.regression.gaze.minimumEyeOpen) continue;
    const raster = await regressionRaster(time);
    const pupils = qa.regression.eyes.map((eye) => pupilMetrics(raster, eye));

    for (const [index, pupil] of pupils.entries()) {
      near(pupil.centerX, 0, limits.centerTolerance, `Взгляд вбок: глаз ${index}, t=${time}`);
      assert.ok(pupil.widthRatio > limits.minimumWidthRatio, `Зрачок уменьшился: глаз ${index}`);
    }
    const [left, right] = pupils;
    for (const axis of ['width', 'height']) {
      near(left[axis] / right[axis], 1, limits.sizeTolerance, `Разные зрачки: ${axis}, t=${time}`);
    }
    near(left.centerY, right.centerY, limits.centerTolerance, `Вертикальный взгляд, t=${time}`);
  }
});

test('Чаши слёз компактны и имеют плотный голубой цвет', async () => {
  const check = qa.regression.waterShape;
  const raster = await regressionRaster(check.time);
  const bowls = colorComponents(raster, isBlue).sort((a, b) => a.left - b.left);
  assert.equal(bowls.length, check.densitySamples.length, 'Не найдены обе чаши слёз');

  for (const [index, bowl] of bowls.entries()) {
    const ratio = (bowl.bottom - bowl.top) / (bowl.right - bowl.left);
    const [red, , blue] = colorAt(raster, ...check.densitySamples[index]);
    assert.ok(
      ratio < check.maxHeightWidthRatio && blue - red > check.minimumBlueMinusRed,
      `Чаша ${index}: высота/ширина=${ratio}, голубой контраст=${blue - red}`,
    );
  }
});

test('Перелив воды движется выразительно и замкнут по положению и скорости', () => {
  for (let eye = 0; eye < qa.regression.eyes.length; eye++) {
    const first = cryWater(0, eye, motion);
    const last = cryWater(motion.duration, eye, motion);
    const before = cryWater(motion.duration - qa.step, eye, motion);
    const after = cryWater(qa.step, eye, motion);
    const samples = Array.from({ length: motion.duration * motion.fps }, (_, frame) =>
      cryWater(frame / motion.fps, eye, motion),
    );

    for (const [field, limits] of Object.entries(qa.waterMotion)) {
      near(first[field], last[field], qa.positionTolerance, `Стык воды ${field}, глаз ${eye}`);
      near(
        (last[field] - before[field]) / qa.step,
        (after[field] - first[field]) / qa.step,
        qa.velocityTolerance,
        `Скорость воды ${field}, глаз ${eye}`,
      );
      const values = samples.map((sample) => sample[field]);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      assert.ok(
        minimum >= -limits.maxAbsolute && maximum <= limits.maxAbsolute,
        `Слишком сильный перелив ${field}: ${minimum}..${maximum}`,
      );
      assert.ok(maximum - minimum > limits.minSpan, `Перелив застыл: ${field}`);
    }
  }
});

function colorArea(raster, predicate, region) {
  return colorComponents(raster, predicate, region).reduce((total, part) => total + part.area, 0);
}

test('Моргание убирает цветную радужку и возвращает открытый взгляд', async () => {
  const check = qa.regression.face;

  for (const times of check.blinkTimes) {
    const rasters = await Promise.all(times.map(regressionRaster));
    for (const eye of qa.regression.eyes) {
      const [before, closed, after] = rasters.map((raster) => colorArea(raster, isAmber, eye));
      assert.ok(before > qa.regression.minimumBowlArea, `До моргания не виден ${eye.name}`);
      assert.ok(
        closed / before < check.maxClosedAmberRatio,
        `Глаз не закрывается: ${eye.name}, ${closed}/${before}`,
      );
      assert.ok(after / before > check.minimumRecoveredAmberRatio, `Глаз не открылся: ${eye.name}`);
    }
  }
});

test('Рот меняет видимую площадь при всхлипах', async () => {
  const check = qa.regression.face;
  const areas = await Promise.all(
    check.mouthTimes.map(async (time) =>
      colorArea(
        await regressionRaster(time),
        (pixel) => Math.max(...pixel) < qa.regression.gaze.pupilChannelMax,
        check.mouthRegion,
      ),
    ),
  );
  const smallest = Math.min(...areas);
  const largest = Math.max(...areas);

  assert.ok(smallest > 0, 'Рот исчезает');
  assert.ok(
    largest / smallest > check.minimumMouthAreaRatio,
    `Рот остаётся статичным: ${smallest}..${largest}`,
  );
});

function highlightMetrics(raster, eye) {
  const pupil = colorComponents(
    raster,
    (pixel) => Math.max(...pixel) < qa.regression.gaze.pupilChannelMax,
    eye,
  ).sort((a, b) => b.area - a.area)[0];
  assert.ok(pupil, `Не найден зрачок: ${eye.name}`);
  const highlight = colorComponents(
    raster,
    (pixel) => Math.min(...pixel) > qa.regression.face.whiteChannelMin,
    pupil,
  ).sort((a, b) => b.area - a.area)[0];
  assert.ok(highlight, `Не найден крупный блик: ${eye.name}`);

  return {
    areaRatio: highlight.area / (pupil.right - pupil.left) ** 2,
    x: highlight.centerX - (pupil.left + pupil.right) / 2,
    y: highlight.centerY - (pupil.top + pupil.bottom) / 2,
  };
}

test('Большие блики смещаются относительно зрачков, а не только вместе с головой', async () => {
  const check = qa.regression.face;
  const rasters = await Promise.all(check.highlightTimes.map(regressionRaster));

  for (const eye of qa.regression.eyes) {
    const metrics = rasters.map((raster) => highlightMetrics(raster, eye));
    assert.ok(
      metrics.every(({ areaRatio }) => areaRatio > check.minimumHighlightAreaRatio),
      `Главный блик слишком мал: ${eye.name}, ${metrics.map(({ areaRatio }) => areaRatio)}`,
    );
    const span = (axis) =>
      Math.max(...metrics.map((item) => item[axis])) -
      Math.min(...metrics.map((item) => item[axis]));
    assert.ok(
      Math.hypot(span('x'), span('y')) > check.minimumHighlightMotion,
      `Блик неподвижен относительно глаза: ${eye.name}`,
    );
  }
});

test('Дрожание бликов замкнуто по положению и скорости', () => {
  for (let eye = 0; eye < qa.regression.eyes.length; eye++) {
    for (let highlight = 0; highlight < art.head.highlights.length; highlight++) {
      const first = cryHighlight(0, eye, highlight, motion);
      const last = cryHighlight(motion.duration, eye, highlight, motion);
      const before = cryHighlight(motion.duration - qa.step, eye, highlight, motion);
      const after = cryHighlight(qa.step, eye, highlight, motion);
      for (const field of Object.keys(first)) {
        near(
          first[field],
          last[field],
          qa.positionTolerance,
          `Стык блика ${eye}/${highlight}/${field}`,
        );
        near(
          (last[field] - before[field]) / qa.step,
          (after[field] - first[field]) / qa.step,
          qa.velocityTolerance,
          `Скорость блика ${eye}/${highlight}/${field}`,
        );
      }
    }
  }
});
