import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const qa = await readJson('src/config/lemur-hang-qa.json');
const volume = qa.bodyVolume;
const current = await readJson(qa.paths.currentArt);
const numberPattern = /-?\d+(?:\.\d+)?/g;

function bodyPathAt(body, amount) {
  const start = body.path.match(numberPattern).map(Number);
  const end = body.curledPath.match(numberPattern).map(Number);
  assert.equal(start.length, end.length, 'Несовместимые контуры тела');
  assert.equal(
    body.path.replace(numberPattern, ''),
    body.curledPath.replace(numberPattern, ''),
    'Разные команды контуров тела',
  );
  let index = 0;

  return body.path.replace(numberPattern, () => {
    const value = start[index] + (end[index] - start[index]) * amount;
    index += 1;

    return String(value);
  });
}

async function bodyWidths(art, bodyPath) {
  const [left, top, width, height] = art.viewBox;
  const scale = volume.rasterScale;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="${art.viewBox.join(' ')}"><path d="${bodyPath}" fill="white"/></svg>`;
  const { data, info } = await sharp(Buffer.from(source))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [pelvis, chest] = volume.axis;
  const direction = chest.map((value, index) => value - pelvis[index]);
  const length = Math.hypot(...direction);
  const normal = [direction[1] / length, -direction[0] / length];
  const inside = (point) => {
    const x = Math.round((point[0] - left) * scale);
    const y = Math.round((point[1] - top) * scale);

    return (
      x >= 0 &&
      x < info.width &&
      y >= 0 &&
      y < info.height &&
      data[(y * info.width + x) * info.channels + info.channels - 1] >= volume.alphaThreshold
    );
  };

  // Ось закреплена анатомическим контрактом; голова, лапы и хвост не расширяют маску.
  return volume.sections.map((section) => {
    const center = pelvis.map((value, index) => value + direction[index] * section);
    if (!inside(center)) return 0;
    const halfWidth = (sign) => {
      let distance = 0;
      for (let offset = volume.scanStep; offset <= volume.scanRadius; offset += volume.scanStep) {
        if (!inside(center.map((value, index) => value + sign * normal[index] * offset))) break;
        distance = offset;
      }

      return distance;
    };

    return halfWidth(-1) + halfWidth(1) + volume.scanStep;
  });
}

test('Средняя часть тела сохраняет достаточную поперечную полноту при поджимании', async (context) => {
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let index = 0; index < volume.morphSamples; index += 1) {
    const amount = index / (volume.morphSamples - 1);
    const widths = await bodyWidths(current, bodyPathAt(current.body, amount));
    minimum = Math.min(minimum, ...widths);
    maximum = Math.max(maximum, ...widths);
    for (const [sectionIndex, width] of widths.entries()) {
      assert.ok(
        width >= volume.minimumWidth,
        `Поджимание ${amount}, сечение ${volume.sections[sectionIndex]}: ${width} < ${volume.minimumWidth}`,
      );
    }
  }

  context.diagnostic(
    `Поперечники текущего тела: ${minimum}-${maximum}; минимум ${volume.minimumWidth}`,
  );
});

test('Тот же фиксированный порог обнаруживает худую перемычку отвергнутой v1', async (context) => {
  let rejected;
  try {
    rejected = await readJson(qa.paths.rejectedArt);
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
    context.skip('Подлинный рисунок v1 отсутствует; текущий порог проверяется отдельно');
    return;
  }
  const widths = await bodyWidths(rejected, rejected.body.path);

  assert.ok(
    widths.every((width) => width < volume.minimumWidth),
    `Отвергнутая форма не обнаружена на каждом среднем сечении: ${widths.join(', ')}`,
  );
  context.diagnostic(`Поперечники v1: ${widths.join(', ')}; минимум ${volume.minimumWidth}`);
});
