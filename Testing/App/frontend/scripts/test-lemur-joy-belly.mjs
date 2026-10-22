import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const motion = readJson('src/config/lemur-joy-motion.json');
const art = readJson(motion.paths.art);
const { lemurJoySvg } = await import(new URL('src/lib/lemur-joy-svg.mjs', root));
const EXPOSED_BELLY_TOP = 300;
const MAXIMUM_MISSING_RATIO = 0.001;
const MARKER = '#ff00ff';

function bellyLayers(svg, legacy) {
  const ancestors = [];

  for (const [tag] of svg.matchAll(/<g\b[^>]*>|<\/g>|<path\b[^>]*\/>/g)) {
    if (tag === '</g>') {
      ancestors.pop();
    } else if (tag.startsWith('<g')) {
      ancestors.push(tag);
    } else if (
      tag.includes('data-part="belly"') ||
      (legacy && tag.includes('fill="url(#cream)"'))
    ) {
      const marked = tag.replace(/fill="[^"]*"/, `fill="${MARKER}"`);
      const opening = svg.match(/<svg\b[^>]*>/)?.[0];
      assert.ok(opening, 'Не найден корневой SVG');
      const clip = `<defs><clipPath id="exposed-belly"><rect x="0" y="${EXPOSED_BELLY_TOP}" width="${art.viewBox[2]}" height="${art.viewBox[3]}"/></clipPath></defs>`;

      return {
        intended: `${opening}${clip}${ancestors.join('')}<g clip-path="url(#exposed-belly)">${marked}</g>${'</g>'.repeat(ancestors.length)}</svg>`,
        visible: svg.replace(tag, marked),
      };
    }
  }
  assert.fail('Не найден конечный контур живота');
}

async function bellyOcclusion(svg, legacy = false) {
  const layers = bellyLayers(svg, legacy);
  const [intended, visible] = await Promise.all(
    Object.values(layers).map((source) =>
      sharp(Buffer.from(source)).ensureAlpha().raw().toBuffer(),
    ),
  );
  assert.equal(visible.length, intended.length, 'Разный размер масок живота');
  let total = 0;
  let missing = 0;

  // Метка проходит через настоящий порядок слоёв; голова и сглаженный внешний край исключены.
  for (let pixel = 0; pixel < intended.length; pixel += 4) {
    if (intended[pixel + 3] !== 255) continue;
    total += 1;
    if (visible[pixel] < 254 || visible[pixel + 1] > 1 || visible[pixel + 2] < 254) missing += 1;
  }
  assert.ok(total > 0, 'Область проверки живота пуста');

  return { total, missing, ratio: missing / total };
}

test('Поднятые руки не выкусывают округлый живот в конечном SVG', async () => {
  const maximum = Math.max(...motion.channels.arms.map(([, amount]) => amount));
  const plateau = motion.channels.arms
    .filter(([, amount]) => amount === maximum)
    .map(([time]) => time);
  const start = Math.min(...plateau) + Math.max(...art.arms.map((arm) => arm.delay));
  const end = Math.max(...plateau);
  const times = [start, (start + end) / 2, end];

  for (const time of times) {
    const result = await bellyOcclusion(lemurJoySvg(time, art, motion));
    assert.ok(
      result.ratio <= MAXIMUM_MISSING_RATIO,
      `t=${time}: руки скрыли ${result.missing}/${result.total} внутренних пикселей живота`,
    );
  }
});

test('Та же проверка обнаруживает отвергнутый выкус версии v3', async () => {
  const archive = 'artifacts/lemur-joy/reviewed-v3/';
  const previousArt = readJson(`${archive}lemur-joy-art.json`);
  const previousMotion = readJson(`${archive}lemur-joy-motion.json`);
  const previous = await import(new URL(`${archive}lemur-joy-svg.mjs`, root));
  const time = (previousMotion.flight.riseEnd + previousMotion.flight.fallStart) / 2;
  const result = await bellyOcclusion(
    previous.lemurJoySvg(time, previousArt, previousMotion),
    true,
  );

  assert.ok(
    result.ratio > MAXIMUM_MISSING_RATIO,
    `Отвергнутый выкус не обнаружен: ${result.missing}/${result.total} пикселей`,
  );
});
