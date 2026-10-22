import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');

function findRawBrand(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const failures = [];
  const inspect = (node) => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      /(?:^|[\s*])(?:botai|bot|ботai)(?=$|[\s*.,!?:])/i.test(
        node.text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ''),
      )
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${file}:${line + 1} Название бренда должно читаться из BRAND.name`);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return failures;
}

test('видимые названия бренда в config берутся из единого источника', () => {
  const directory = resolve(root, 'src/config');
  const failures = readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && name !== 'brand.ts')
    .flatMap((name) => findRawBrand(name, readFileSync(resolve(directory, name), 'utf8')));
  assert.deepEqual(failures, []);
});

test('guard отличает текстовый бренд от адресов и технических ключей', () => {
  for (const name of ['botai', 'bot', 'ботai']) {
    assert.equal(findRawBrand('copy.ts', `const title = 'Привет! Я ${name}';`).length, 1);
  }
  assert.deepEqual(
    findRawBrand(
      'copy.ts',
      "const COPY = { title: `Привет! Я ${BRAND.name}`, email: 'test@botai.ru', contact: 'botai.ege@gmail.com', storageKey: 'botai-tasks' };",
    ),
    [],
  );
});

test('металлическая основа ai сохраняет читаемый fallback', () => {
  const css = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');
  const rules = [...css.matchAll(/\.wordmark-ai\s*\{([^}]+)\}/g)].map((match) => match[1]);
  assert.ok(rules.length > 0);
  assert.ok(rules.some((rule) => /background-clip:\s*text/.test(rule)));
  assert.ok(rules.some((rule) => /background:\s*none/.test(rule) && /color:\s*inherit/.test(rule)));
  for (const rule of rules)
    assert.doesNotMatch(rule, /(?:animation|mask|font-family|font-size|letter-spacing)\s*:/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\),\s*print/);
});

test('блик hero меняет только opacity и отключается при reduced motion', () => {
  const css = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');
  const start = css.indexOf('@keyframes brand-metal-light');
  assert.ok(start >= 0);
  const end = css.indexOf('@media', start);
  const keyframes = css.slice(start, end);
  assert.match(keyframes, /opacity:/);
  assert.doesNotMatch(keyframes, /(?:transform|background|filter|color|width|height)[^:]*:/);
  const reflectionRules = [...css.matchAll(/[^{}]*\.wordmark-ai::after\s*\{([^}]+)\}/g)].map(
    (match) => match[1],
  );
  assert.ok(reflectionRules.some((rule) => /content:\s*attr\(data-reflection\)/.test(rule)));
  assert.ok(reflectionRules.some((rule) => /animation:\s*brand-metal-light/.test(rule)));
  assert.ok(
    reflectionRules.some(
      (rule) => /animation:\s*none/.test(rule) && /transition:\s*none/.test(rule),
    ),
  );
  assert.ok(reflectionRules.some((rule) => /display:\s*none/.test(rule)));
  for (const rule of reflectionRules)
    assert.doesNotMatch(rule, /infinite|transition:\s*(?:all|background)/);
});

test('guard не путает email с брендом, но обнаруживает название рядом с адресом', () => {
  assert.deepEqual(findRawBrand('copy.ts', "const title = 'Пиши на botai.ege@gmail.com';"), []);
  assert.equal(
    findRawBrand('copy.ts', "const title = 'ботai: пиши на botai.ege@gmail.com';").length,
    1,
  );
});
