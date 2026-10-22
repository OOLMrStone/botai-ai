import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const formSection = 'src/components/common/FormSection.tsx';
const fontRoot = 'src/app/layout.tsx';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function inspect(file, code) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = [];
  const report = (node, rule) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    failures.push(`${file}:${line} ${rule}`);
  };

  walk(source, (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const token of node.text.split(/\s+/)) {
        if (/(?:^|:)!?font-(?:extrabold|black)(?:!|$)/.test(token))
          report(node, 'Вес выше 700 обходит спокойную типографическую шкалу');
        if (/(?:^|:)!?-?tracking-/.test(token) || /\[letter-spacing:/.test(token))
          report(node, 'Локальный tracking обходит общий межбуквенный интервал');
        if (
          /(?:^|:)!?font-(?:serif|mono)(?:!|$)/.test(token) ||
          /\[font-family:/.test(token) ||
          /(?:^|:)!?font-\[(?!weight:|[0-9])/.test(token)
        )
          report(node, 'Локальный шрифт обходит семейство продукта');
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      /^(?:letterSpacing|fontFamily)$/.test(node.name.getText(source).replace(/['"]/g, ''))
    )
      report(node, 'Inline-типографика обходит тему');
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      /^(?:fieldset|legend)$/.test(node.tagName.getText(source)) &&
      file !== formSection
    )
      report(node, 'Группа полей должна использовать FormSection с единым отступом');
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('next/font/') &&
      file !== fontRoot
    )
      report(node, 'Шрифт загружается только в корневом layout');
  });
  return failures;
}

test('типографика и группы полей не имеют локальных обходов', () => {
  const failures = files(resolve(root, 'src')).flatMap((path) => {
    const file = relative(root, path);
    const code = readFileSync(path, 'utf8');
    if (path.endsWith('.css')) {
      if (file === 'src/app/globals.css') return [];
      return /(?:letter-spacing|font-family)\s*:/.test(code)
        ? [`${file}: CSS обходит типографику темы`]
        : [];
    }
    return inspect(file, code);
  });
  assert.deepEqual(failures, []);
});

test('Onest единым локальным variable-шрифтом обслуживает обе письменности', () => {
  const code = readFileSync(resolve(root, fontRoot), 'utf8');
  const source = ts.createSourceFile(
    fontRoot,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const loaders = [];
  const calls = [];
  walk(source, (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith('next/font/')) {
      assert.equal(node.moduleSpecifier.text, 'next/font/local');
      loaders.push(node.importClause.name.text);
    }
  });
  walk(source, (node) => {
    if (ts.isCallExpression(node) && loaders.includes(node.expression.getText(source)))
      calls.push(node);
  });
  assert.equal(loaders.length, 1);
  assert.equal(calls.length, 1);
  const call = calls[0].getText(source);
  assert.match(call, /src:\s*['"]\.\.\/assets\/fonts\/onest-variable\.ttf['"]/);
  assert.match(call, /variable:\s*['"]--font-product['"]/);
  assert.match(call, /weight:\s*['"]100 900['"]/);
  assert.match(call, /preload:\s*true/);
  assert.doesNotMatch(code, /--font-(?:cyrillic|latin)|unicode-range/);
  assert.ok(readFileSync(resolve(root, 'src/assets/fonts/onest-variable.ttf')).length > 0);
});

test('тема задаёт одно семейство и один межбуквенный интервал', () => {
  const css = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  assert.match(css, /--font-sans:\s*var\(--font-product\)/);
  assert.doesNotMatch(css, /--font-(?:cyrillic|latin)/);
  assert.equal([...css.matchAll(/--tracking-ui\s*:/g)].length, 1);
  assert.match(css, /--tracking-ui:\s*0(?:em)?\s*;/);
  const intervals = [...css.matchAll(/letter-spacing\s*:\s*([^;]+);/g)].map((match) =>
    match[1].trim(),
  );
  assert.deepEqual(intervals, ['var(--tracking-ui)']);
  assert.match(css, /font-kerning:\s*normal/);
});

test('guard ловит tracking в вариантах, шаблонах и произвольном CSS', () => {
  for (const code of [
    'const x = "md:tracking-tight"',
    'const x = "font-extrabold"',
    'const x = "md:font-black"',
    'const x = `text-base ${active ? "tracking-wide" : ""}`',
    'const x = "[letter-spacing:0.1em]"',
    'const x = { letterSpacing: "-0.02em" }',
  ])
    assert.ok(inspect('src/components/Example.tsx', code).length > 0, code);
});

test('guard ловит отдельный шрифт и нестандартную группу полей', () => {
  for (const code of [
    'const x = "font-serif"',
    'const x = "font-[Arial]"',
    'const x = "font-[family-name:Arial]"',
    'const x = { fontFamily: "Arial" }',
    'const x = <fieldset><legend>Label</legend></fieldset>',
    'import { Manrope } from "next/font/google"',
  ])
    assert.ok(inspect('src/components/Example.tsx', code).length > 0, code);
});

test('guard допускает общий компонент, семантические классы и математический рендерер', () => {
  assert.deepEqual(
    inspect(formSection, '<fieldset><legend>{title}</legend>{children}</fieldset>'),
    [],
  );
  assert.deepEqual(
    inspect(
      'src/components/Example.tsx',
      '<FormSection title={copy.title}><p className={layout.training.blockText} /></FormSection>',
    ),
    [],
  );
  assert.deepEqual(
    inspect(
      'src/components/common/MathFormula.tsx',
      'const html = katex.renderToString(value, options)',
    ),
    [],
  );
});
