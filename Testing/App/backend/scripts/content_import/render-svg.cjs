'use strict';
// This program is run only inside the existing pinned frontend image, network:none.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('/app/node_modules/sharp');
const input = '/input';
const output = '/output';
const files = fs.readdirSync(input).filter(name => /^[a-f0-9]{64}\.svg$/.test(name)).sort();
if (!files.length || files.length > 256) throw new Error('SVG batch count budget');
(async () => {
  const results = [];
  let bytes = 0;
  let pixels = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(input, file));
    if (raw.length > 2 * 1024 * 1024) throw new Error('SVG input byte budget');
    const {data, info} = await sharp(raw, {density: 144, failOn: 'warning', unlimited: false, limitInputPixels: 20000000})
      .png({compressionLevel: 9}).toBuffer({resolveWithObject: true});
    if (info.width > 8192 || info.height > 8192 || info.width * info.height > 20000000 || data.length > 8 * 1024 * 1024)
      throw new Error('PNG asset budget');
    pixels += info.width * info.height;
    bytes += data.length;
    if (pixels > 64000000 || bytes > 64 * 1024 * 1024) throw new Error('PNG aggregate budget');
    const name = file.replace(/\.svg$/, '.png');
    fs.writeFileSync(path.join(output, name), data, {mode: 0o600, flag: 'wx'});
    results.push({input: file, output: name, width: info.width, height: info.height, bytes: data.length});
  }
  fs.writeFileSync(path.join(output, 'render-report.json'), JSON.stringify({versions: sharp.versions, assets: results}, null, 2),
                   {mode: 0o600, flag: 'wx'});
})().catch(error => { console.error(error.name + ': SVG rasterization failed'); process.exitCode = 1; });
