import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const settings = JSON.parse(
  await readFile(new URL('../../src/config/lemur-export.json', import.meta.url), 'utf8'),
);

export function lemurFrameName(index) {
  return String(index).padStart(settings.frameDigits, '0');
}

export async function exportLemurAnimation({ name, work, output, fps, count, size }) {
  const files = settings.animations[name];

  execFileSync('ffmpeg', [
    ...settings.ffmpegArguments,
    '-framerate',
    String(fps),
    '-i',
    resolve(work, `%0${settings.frameDigits}d.png`),
    '-frames:v',
    String(count),
    ...(files.alpha ? settings.flattenArguments : []),
    ...settings.mp4Arguments,
    resolve(output, files.video),
  ]);

  const pixels = [];
  const delays = [];
  const transparentFrames = [];
  for (let index = 0; index < count; index++) {
    const framePath = resolve(work, `${lemurFrameName(index)}.png`);
    if (!files.alpha) pixels.push(await sharp(framePath).removeAlpha().raw().toBuffer());
    delays.push(
      Math.round(((index + 1) * settings.millisecondsPerSecond) / fps) -
        Math.round((index * settings.millisecondsPerSecond) / fps),
    );
    transparentFrames.push('-d', String(delays[index]), framePath);
  }

  if (files.alpha) {
    // Точный режим сохраняет RGB прозрачных пикселей без цветных шлейфов в просмотрщиках.
    execFileSync('img2webp', [
      ...settings.transparentWebpArguments,
      ...transparentFrames,
      '-o',
      resolve(output, files.master),
    ]);
  } else {
    await sharp(Buffer.concat(pixels), {
      limitInputPixels: size * size * count,
      raw: { width: size, height: size * count, pageHeight: size, channels: settings.channels },
    })
      .webp({ ...settings.webp, delay: delays })
      .toFile(resolve(output, files.master));
  }
  await sharp(resolve(work, `${lemurFrameName(0)}.png`)).toFile(resolve(output, settings.poster));

  for (const mirror of files.mirrors ?? []) {
    const destination = resolve(mirror.output);

    await mkdir(destination, { recursive: true });
    execFileSync('ffmpeg', [
      ...settings.ffmpegArguments,
      '-framerate',
      String(fps),
      '-i',
      resolve(work, `%0${settings.frameDigits}d.png`),
      '-frames:v',
      String(count),
      '-vf',
      'hflip',
      ...settings.mp4Arguments,
      resolve(destination, mirror.video),
    ]);
    await sharp(resolve(output, files.master), {
      animated: true,
      limitInputPixels: size * size * count,
    })
      .flop()
      .webp({ ...settings.webp, delay: delays })
      .toFile(resolve(destination, mirror.master));
    await sharp(resolve(output, settings.poster))
      .flop()
      .toFile(resolve(destination, settings.poster));
  }
}
