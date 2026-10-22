import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import { packRgba, transparentSvg } from './export-embedded-bo.mjs';

test('native background removal preserves internal white artwork and fails if the background changes', () => {
  const art = { viewBox: [0, 0, 620, 620], colors: { white: '#FFFFFF' } };
  const whiteEye = '<circle cx="20" cy="20" r="4" fill="#FFFFFF"/>';
  const background = '<path fill="#FFFFFF" d="M0 0H620V620H0Z"/>';
  const svg = `<svg>${background}${whiteEye}</svg>`;
  assert.equal(transparentSvg(svg, 'path', art), `<svg>${whiteEye}</svg>`);
  assert.equal(transparentSvg(svg, 'none', art), svg);
  assert.throws(() => transparentSvg(`<svg>${whiteEye}</svg>`, 'path', art));
  assert.throws(() => transparentSvg(`<svg>${background}${background}</svg>`, 'path', art));
});

test('packed video preserves straight RGB and alpha independently, including white and antialiased pixels', () => {
  const rgba = Buffer.from([255, 255, 255, 255, 255, 243, 213, 128, 0, 0, 0, 0]);
  const packed = packRgba(rgba, 3, 1);
  assert.deepEqual([...packed.subarray(0, 6)], [255, 255, 255, 255, 243, 213]);
  assert.deepEqual([...packed.subarray(6, 9)], [255, 243, 213]);
  assert.deepEqual([...packed.subarray(9)], [255, 255, 255, 128, 128, 128, 0, 0, 0]);
});

test('transparent posters retain the accepted first-frame appearance and internal white highlights', async () => {
  for (const name of ['wave', 'sit', 'joy', 'hang']) {
    const path = `public/lemur-${name}`;
    const original = await sharp(`${path}/poster.png`).removeAlpha().raw().toBuffer();
    const { data, info } = await sharp(`${path}/poster-alpha.png`)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const white = await sharp(`${path}/poster-alpha.png`)
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer();
    assert.deepEqual([info.width, info.height, info.channels], [1080, 1080, 4]);
    let transparent = 0;
    let whiteDetails = 0;
    let maximumDifference = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (!data[index + 3]) transparent++;
      if (
        data[index] === 255 &&
        data[index + 1] === 255 &&
        data[index + 2] === 255 &&
        data[index + 3] === 255
      )
        whiteDetails++;
    }
    for (let index = 0; index < original.length; index++) {
      maximumDifference = Math.max(maximumDifference, Math.abs(original[index] - white[index]));
    }
    assert.ok(transparent > 0, name);
    assert.ok(whiteDetails > 0, name);
    assert.ok(
      maximumDifference <= 2,
      `${name}: native edge compositing drift ${maximumDifference}`,
    );
  }
});
