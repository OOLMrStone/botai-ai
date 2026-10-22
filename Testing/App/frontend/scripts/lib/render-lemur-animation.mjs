import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { exportLemurAnimation, lemurFrameName } from './export-lemur-animation.mjs';

const root = resolve(import.meta.dirname, '../..');
const settings = JSON.parse(
  await readFile(new URL('../../src/config/lemur-export.json', import.meta.url), 'utf8'),
);

async function readConfig(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function renderFrames(times, work, keysOnly, draw) {
  for (const [index, time] of times.entries()) {
    const name = `${keysOnly ? 'key-' : ''}${lemurFrameName(index)}`;
    const svg = draw(time);

    await writeFile(resolve(work, `${name}.svg`), svg);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(resolve(work, `${name}.png`));
  }
}

async function renderContactSheet(times, work, draw) {
  const { columns, tileSize, background, path } = settings.contactSheet;
  const tiles = await Promise.all(
    times.map(async (time, index) => ({
      input: await sharp(Buffer.from(draw(time)))
        .resize(tileSize, tileSize)
        .png()
        .toBuffer(),
      left: (index % columns) * tileSize,
      top: Math.floor(index / columns) * tileSize,
    })),
  );

  await sharp({
    create: {
      width: columns * tileSize,
      height: Math.ceil(times.length / columns) * tileSize,
      channels: settings.channels,
      background,
    },
  })
    .composite(tiles)
    .png()
    .toFile(resolve(work, path));
}

export async function renderLemurAnimation({ name, svg, pose, motion: suppliedMotion }) {
  const motion = suppliedMotion ?? (await readConfig(settings.animations[name].motion));
  const art = await readConfig(motion.paths.art);
  const baseArt = motion.paths.baseArt ? await readConfig(motion.paths.baseArt) : undefined;
  const work = resolve(root, motion.paths.work);
  const output = resolve(root, motion.paths.output);
  const keysOnly = process.argv.includes('--keys');
  const count = motion.fps * motion.duration;
  const times = keysOnly
    ? motion.qaTimes
    : Array.from({ length: count }, (_, index) => index / motion.fps);
  const draw = (time) => svg(time, art, motion, baseArt);

  await mkdir(work, { recursive: true });
  await mkdir(output, { recursive: true });
  await renderFrames(times, work, keysOnly, draw);
  await renderContactSheet(motion.qaTimes, work, draw);

  if (!keysOnly) {
    await exportLemurAnimation({
      name,
      work,
      output,
      fps: motion.fps,
      count,
      size: art.size ?? baseArt?.size,
    });
    await writeFile(
      resolve(root, motion.paths.manifest),
      JSON.stringify(
        {
          fps: motion.fps,
          duration: motion.duration,
          frames: times.map((time, index) => ({ index, time, ...pose(time, motion) })),
        },
        null,
        2,
      ),
    );
  }

  console.log(JSON.stringify({ output, keysOnly, frames: times.length }));
}
