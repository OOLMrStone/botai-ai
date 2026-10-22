// Read-only manifest inventory; vendored compiled modules are outside its scope.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const packages = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name);
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) walk(target);
    else if (name === 'package.json') {
      try {
        const info = JSON.parse(fs.readFileSync(target));
        if (info.name && info.version) packages.push({ path: target, name: info.name, version: info.version });
      } catch {}
    }
  }
}
walk('/app/node_modules');
const forbidden = ['shadcn', 'braces', 'micromatch', 'fast-glob', 'eslint', 'hono', 'undici', 'ts-morph'];
const found = packages.filter((item) => forbidden.includes(item.name));
const result = { next: require('next/package.json').version, packages: packages.length, unique: new Set(packages.map((item) => item.name + '@' + item.version)).size, forbiddenFound: found, packagesInventory: packages, scope: 'Physical package manifests only; excludes unmanifested compiled vendored modules and OS CVEs' };
console.log(JSON.stringify(result, null, 2));
if (found.length) process.exitCode = 1;
