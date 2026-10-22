import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const semanticRadii = new Set(['control', 'tile', 'card', 'panel']);
const controlModules = new Map([
  ['@/components/ui/button', new Set(['Button', 'buttonVariants'])],
  ['@/components/ui/input', new Set(['Input'])],
  ['@/components/ui/validated-input', new Set(['ValidatedInput'])],
  ['@/components/onboarding/ValidatedField', new Set(['ValidatedField'])],
  ['@/components/storefront/StorefrontAction', new Set(['StorefrontAction'])],
]);
// Эти файлы реализуют сам примитив; исключение не распространяется на его потребителей.
const primitiveGeometry = new Set(['src/components/ui/button.tsx', 'src/components/ui/input.tsx']);
const forwardingProps = new Map([
  ['src/components/onboarding/ValidatedField.tsx', new Set(['props'])],
  ['src/components/ui/validated-input.tsx', new Set(['props'])],
  ['src/components/ui/dialog.tsx', new Set(['handleProps'])],
]);
const radiusExceptions = new Map([
  ['src/components/ui/progress.tsx', new Set(['rounded-full'])],
  ['src/components/ui/radio-group.tsx', new Set(['rounded-full'])],
  ['src/components/ui/skeleton.tsx', new Set(['rounded-md'])],
]);
// Вспомогательный локальный инструмент не входит в пользовательский интерфейс.
const developmentOnly = new Set(['src/components/dev/DevTools.tsx']);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function classBase(token) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] === '[' || token[index] === '(') depth += 1;
    if (token[index] === ']' || token[index] === ')') depth -= 1;
    if (token[index] === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/g, '');
}

function radiusRole(token) {
  const base = classBase(token);
  if (/^\[border(?:-[a-z]+)*-radius:/.test(base)) return false;
  if (!/^rounded(?:-|$)/.test(base)) return null;
  const value = base
    .replace(/^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee)(?=-))?/, '')
    .replace(/^-/, '');
  if (semanticRadii.has(value) || value === 'full' || value === 'none' || value === '[inherit]')
    return true;
  if (/^\[(?:calc|max|min)\(/.test(value)) {
    const references = [...value.matchAll(/var\(--radius-([a-z]+)\)/g)];
    return references.length > 0 && references.every((match) => semanticRadii.has(match[1]));
  }
  return false;
}

function isGeometry(token) {
  const base = classBase(token);
  return (
    /^(?:(?:min-|max-)?[wh]-|size-|rounded(?:-|$))/.test(base) ||
    /^text-(?:xs|sm|base|lg|[2-9]?xl)(?:\/|$)/.test(base) ||
    /^text-\[(?:length:|\d|calc\(|clamp\(|var\(--(?:font|text))/.test(base) ||
    /^\[(?:width|height|min-width|max-width|min-height|max-height|border-radius|font-size):/.test(
      base,
    )
  );
}

function inspectSource(file, code) {
  if (developmentOnly.has(file)) return [];
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = new Map();
  const bindings = new Map();
  const controls = new Set(['button', 'input']);
  const configImports = new Set();
  const isConfig = file.startsWith('src/config/');
  const isView = file.startsWith('src/app/') || file.startsWith('src/components/');
  const report = (node, rule, message) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    const label = `${file}:${position.line + 1}:${position.character + 1} [${rule}] ${message}`;
    failures.set(label, label);
  };

  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      bindings.set(node.name.text, node.body);
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const moduleName = node.moduleSpecifier.text;
    const named = node.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const item of named.elements) {
        if (moduleName.startsWith('@/config/')) configImports.add(item.name.text);
        if (controlModules.get(moduleName)?.has(item.propertyName?.text ?? item.name.text)) {
          controls.add(item.name.text);
        }
      }
    }
  });

  function inspectExpression(node, check, seen = new Set()) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      if (!configImports.has(node.text)) inspectExpression(bindings.get(node.text), check, seen);
      return;
    }
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      check(node, node.text);
      return;
    }
    ts.forEachChild(node, (child) => inspectExpression(child, check, seen));
  }

  function inspectControlClass(node) {
    inspectExpression(node, (literal, value) => {
      for (const token of value.split(/\s+/)) {
        if (isGeometry(token))
          report(
            literal,
            'control-geometry',
            `«${token}» задаёт геометрию контрола локально; используй роль из config/layout.ts`,
          );
      }
    });
  }

  function inspectStyle(node) {
    if (!node) return;
    if (ts.isJsxExpression(node)) return inspectStyle(node.expression);
    if (ts.isIdentifier(node)) return inspectStyle(bindings.get(node.text));
    walk(node, (property) => {
      if (!ts.isPropertyAssignment(property)) return;
      const name = property.name.getText(source).replace(/['"]/g, '');
      if (
        /^(?:border(?:TopLeft|TopRight|BottomLeft|BottomRight)?Radius|width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize)$/.test(
          name,
        )
      ) {
        report(
          property,
          'control-style',
          `style.${name} обходит геометрию контрола; перенеси значение в роль config/layout.ts`,
        );
      }
    });
  }

  function inspectSpread(node) {
    if (ts.isIdentifier(node) && forwardingProps.get(file)?.has(node.text)) return;
    const expression = ts.isIdentifier(node) ? bindings.get(node.text) : node;
    if (!expression || !ts.isObjectLiteralExpression(expression)) {
      report(
        node,
        'control-spread',
        'Непрозрачный spread на контроле может переопределить геометрию; передай props явно',
      );
      return;
    }
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) inspectSpread(property.expression);
      if (ts.isPropertyAssignment(property)) {
        const name = property.name.getText(source).replace(/['"]/g, '');
        if (name === 'className') inspectControlClass(property.initializer);
        if (name === 'style') inspectStyle(property.initializer);
      }
    }
  }

  walk(source, (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const token of node.text.split(/\s+/)) {
        const radius = radiusRole(token);
        if (radius === null) continue;
        const base = classBase(token);
        if (isView && !radiusExceptions.get(file)?.has(base)) {
          report(
            node,
            'local-radius',
            `«${token}» находится во view; выбери семантическую роль из config/layout.ts`,
          );
        }
        if (isConfig && !radius)
          report(
            node,
            'radius-role',
            `«${token}» не имеет роли; допустимы control/tile/card/panel, круг, inherit или calc от семантического радиуса`,
          );
      }
    }
    if (
      isView &&
      ts.isPropertyAssignment(node) &&
      /^(?:border(?:TopLeft|TopRight|BottomLeft|BottomRight)?Radius)$/.test(
        node.name.getText(source).replace(/['"]/g, ''),
      )
    ) {
      report(node, 'local-radius-style', 'Локальный borderRadius обходит семантические роли');
    }
    if (!isView || primitiveGeometry.has(file)) return;
    if (ts.isCallExpression(node) && controls.has(node.expression.getText(source))) {
      for (const argument of node.arguments) inspectControlClass(argument);
    }
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    if (!controls.has(node.tagName.getText(source))) return;
    for (const attribute of node.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) inspectSpread(attribute.expression);
      if (!ts.isJsxAttribute(attribute)) continue;
      if (attribute.name.getText(source) === 'className')
        inspectControlClass(attribute.initializer);
      if (attribute.name.getText(source) === 'style') inspectStyle(attribute.initializer);
    }
  });
  return [...failures.values()];
}

function inspectRadiusTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...clean.matchAll(/(--radius(?:-[\w-]+)?)\s*:\s*([^;}]+)\s*;/g)];
  const values = new Map();
  const failures = [];
  for (const [, name, value] of declarations) {
    if (!values.has(name)) values.set(name, []);
    values.get(name).push(value.trim());
  }
  for (const role of semanticRadii) {
    const name = `--radius-${role}`;
    const entries = values.get(name) ?? [];
    if (entries.length !== 1)
      failures.push(`${name}: должен иметь ровно один источник, найдено ${entries.length}`);
  }
  const pixels = (name) => {
    const value = values.get(name)?.[0] ?? '';
    const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value);
    return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : NaN;
  };
  for (const [role, expected] of [
    ['tile', 16],
    ['card', 24],
    ['panel', 32],
  ]) {
    if (pixels(`--radius-${role}`) !== expected)
      failures.push(
        `${role}: контракт спецификации требует ${expected} CSS px при корневом шрифте 16 px`,
      );
  }
  if (pixels('--radius-control') < 9999 || !Number.isFinite(pixels('--radius-control')))
    failures.push('control: токен должен обеспечивать полукруглые торцы при любой ширине');
  return failures;
}

test('guard: локальные радиусы и inline style запрещены', () => {
  for (const jsx of [
    '<div className="rounded-xl" />',
    '<div className={cn(ok && "hover:rounded-[19px]")} />',
    'const shape = "rounded-card"; <div className={shape} />',
    '<div style={{ borderRadius: 24 }} />',
    '<div className="[border-radius:24px]" />',
    '<div className={`rounded-${radius}`} />',
  ])
    assert.ok(inspectSource('src/components/Example.tsx', jsx).length, jsx);
});

test('guard: геометрия контрола запрещена через alias, const, spread и helper', () => {
  const prefix =
    'import { Button as Action, buttonVariants as variants } from "@/components/ui/button";';
  for (const jsx of [
    '<Action className="h-12" />',
    '<Action className="md:!min-h-10 text-lg" />',
    'const local = "w-40"; <Action className={cn(local)} />',
    'const props = { className: "size-8" }; <Action {...props} />',
    '<Action style={{ minHeight: 32 }} />',
    '<Action style={{ height: 32, borderRadius: 3 }} />',
    'const style = { height: 32 }; <Action style={style} />',
    'function geometry() { return "h-8"; } <Action className={geometry()} />',
    '<Action {...unknownProps} />',
    '<a className={variants({ className: "rounded-lg" })} />',
    '<Action className={`h-${height}`} />',
    '<button className="text-[18px]" />',
  ])
    assert.ok(inspectSource('src/components/Example.tsx', prefix + jsx).length, jsx);
});

test('guard: config-роли и визуально независимые иконки разрешены', () => {
  const code = `import { Button } from '@/components/ui/button';
    import { layout } from '@/config/layout';
    <Button size="icon" className={cn(layout.training.controlButton, active && 'bg-muted')}>
      <Icon className="size-5" />
    </Button>`;
  assert.deepEqual(inspectSource('src/components/Example.tsx', code), []);
});

test('guard: config допускает семантику и производные радиусы', () => {
  assert.deepEqual(
    inspectSource(
      'src/config/example.ts',
      `const styles = 'rounded-card rounded-control rounded-tile rounded-t-panel rounded-full rounded-[inherit] rounded-[calc(var(--radius-card)-1rem)] rounded-[max(0px,calc(var(--radius-card)-1rem))]'`,
    ),
    [],
  );
  for (const shape of [
    'rounded-2xl',
    'rounded-[17px]',
    'rounded-[calc(99px)]',
    'rounded-[calc(var(--radius-xl)-4px)]',
  ]) {
    assert.ok(inspectSource('src/config/example.ts', `const shape = '${shape}'`).length, shape);
  }
});

test('guard: дублирование и дрейф источника радиусов обнаруживаются', () => {
  const css =
    '@theme { --radius-control: 9999px; --radius-tile: 1rem; --radius-card: 24px; --radius-panel: 2rem; }';
  assert.deepEqual(inspectRadiusTokens(css), []);
  assert.ok(inspectRadiusTokens(css + ':root { --radius-card: 24px; }').length);
  assert.ok(inspectRadiusTokens(css.replace('24px', '18px')).length);
});

test('проект: view не создаёт собственную геометрию контролов и радиусов', () => {
  const failures = ['src/app', 'src/components', 'src/config'].flatMap((directory) =>
    sourceFiles(resolve(root, directory)).flatMap((path) =>
      inspectSource(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')),
    ),
  );
  assert.equal(failures.length, 0, `\n${failures.join('\n')}`);
});

test('проект: радиусы имеют единственный семантический источник', () => {
  const failures = inspectRadiusTokens(readFileSync(resolve(root, 'src/app/globals.css'), 'utf8'));
  assert.equal(failures.length, 0, failures.join('\n'));
});

function loadModule(name, cache = new Map()) {
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const extension = name.startsWith('@/components/') ? '.tsx' : '.ts';
  const filename = resolve(root, 'src', `${name.slice(2)}${extension}`);
  const loaded = { exports: {} };
  cache.set(name, loaded);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  compileFunction(compiled.outputText, ['require', 'module', 'exports'], { filename })(
    (dependency) => loadModule(dependency, cache),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const controlContract = {
  default: { height: 48, radius: 'control' },
  multiline: { minHeight: 48, radius: 'control', wrap: true },
  compact: { height: 44, radius: 'control' },
  icon: { height: 48, width: 48, radius: 'control' },
  'icon-compact': { height: 44, width: 44, radius: 'control' },
  card: { radius: 'card' },
  segment: { height: 48 },
};

function inspectControlRoles(sizes) {
  const failures = [];
  const names = Object.keys(sizes).sort();
  if (names.join(',') !== Object.keys(controlContract).sort().join(',')) {
    failures.push(
      `Набор размеров Button изменился: ${names.join(', ')}. Новая роль требует геометрического контракта и браузерной проверки`,
    );
  }
  for (const [name, contract] of Object.entries(controlContract)) {
    const classes = typeof sizes[name] === 'string' ? sizes[name].split(/\s+/) : [];
    const dimension = (axis) =>
      classes.flatMap((token) => {
        const match = new RegExp(`^(?:${axis}|size)-(\\d+(?:\\.\\d+)?)$`).exec(token);
        return match ? [Number(match[1]) * 4] : [];
      });
    for (const [axis, field] of [
      ['h', 'height'],
      ['w', 'width'],
      ['min-h', 'minHeight'],
    ]) {
      if (contract[field] && !dimension(axis).includes(contract[field]))
        failures.push(`${name}: ${field} должен быть ${contract[field]} CSS px`);
    }
    if (contract.radius && !classes.includes(`rounded-${contract.radius}`))
      failures.push(`${name}: неверное семейство формы ${contract.radius}`);
    if (contract.wrap && (!classes.includes('h-auto') || !classes.includes('whitespace-normal')))
      failures.push(`${name}: подпись должна переноситься и определять высоту кнопки`);
  }
  return failures;
}

test('guard: новый размер Button и уменьшение области нажатия требуют нового контракта', () => {
  const valid = {
    default: 'h-12 rounded-control',
    multiline: 'h-auto min-h-12 whitespace-normal rounded-control',
    compact: 'h-11 rounded-control',
    icon: 'size-12 rounded-control',
    'icon-compact': 'size-11 rounded-control',
    card: 'h-auto rounded-card',
    segment: 'h-12',
  };
  assert.deepEqual(inspectControlRoles(valid), []);
  assert.ok(inspectControlRoles({ ...valid, tiny: 'h-6 rounded-control' }).length);
  assert.ok(inspectControlRoles({ ...valid, icon: 'size-8 rounded-control' }).length);
  assert.ok(
    inspectControlRoles({ ...valid, multiline: 'h-12 whitespace-nowrap rounded-control' }).length,
  );
  assert.ok(
    inspectControlRoles({ ...valid, multiline: 'h-auto min-h-6 whitespace-normal rounded-control' })
      .length,
  );
});

test('проект: публичные размеры Button соответствуют геометрическим ролям', () => {
  const { layout } = loadModule('@/config/layout');
  const failures = inspectControlRoles(layout.control.sizes);
  assert.equal(failures.length, 0, failures.join('\n'));
});

test('проект: внешний className не перебивает геометрию Button', () => {
  const { Button } = loadModule('@/components/ui/button');
  const { layout } = loadModule('@/config/layout');
  for (const size of Object.keys(controlContract)) {
    const rendered = Button({ size, className: 'h-2 rounded-none' });
    const classes = rendered.props.className.split(/\s+/);
    const roleClasses = layout.control.sizes[size]
      .split(/\s+/)
      .filter((token) => /^(?:h-|size-|rounded)/.test(token));
    for (const token of roleClasses)
      assert.ok(classes.includes(token), `${size}: внешний className перебил ${token}`);
    assert.ok(
      !classes.includes('h-2') && !classes.includes('rounded-none'),
      `${size}: сохранился внешний override`,
    );
  }
});

test('guard: forwarding исключения ограничены точным файлом и именем props', () => {
  const prefix = 'import { Input } from "@/components/ui/input";';
  assert.deepEqual(
    inspectSource('src/components/ui/validated-input.tsx', prefix + '<Input {...props} />'),
    [],
  );
  assert.ok(
    inspectSource('src/components/AnotherInput.tsx', prefix + '<Input {...props} />').length,
  );
  assert.ok(
    inspectSource('src/components/ui/validated-input.tsx', prefix + '<Input {...unknownProps} />')
      .length,
  );
});

test('проект: внешний className не перебивает геометрию Input', () => {
  const { Input } = loadModule('@/components/ui/input');
  const { layout } = loadModule('@/config/layout');
  const rendered = Input({ className: 'h-2 rounded-none' });
  const classes = rendered.props.className.split(/\s+/);
  for (const token of layout.control.input
    .split(/\s+/)
    .filter((item) => /^(?:h-|rounded)/.test(item))) {
    assert.ok(classes.includes(token), `Input: внешний className перебил ${token}`);
  }
  assert.ok(
    !classes.includes('h-2') && !classes.includes('rounded-none'),
    'Input: сохранился внешний override',
  );
});

test('guard: витрина и desktop не обходят контроль геометрии через обёртку действия', () => {
  const prefix =
    'import { StorefrontAction as Action } from "@/components/storefront/StorefrontAction";';
  for (const file of ['src/components/storefront/Example.tsx', 'src/components/app/Example.tsx']) {
    for (const jsx of [
      '<Action className="lg:h-16" />',
      'const geometry = "md:text-xl"; <Action className={geometry} />',
      '<Action style={{ borderRadius: 8 }} />',
      'const props = { className: "lg:rounded-none" }; <Action {...props} />',
      '<Action {...unknownProps} />',
    ])
      assert.ok(inspectSource(file, prefix + jsx).length, `${file}: ${jsx}`);
    assert.deepEqual(
      inspectSource(
        file,
        prefix +
          'import { layout } from "@/config/layout"; <Action className={layout.storefront.navCta} />',
      ),
      [],
    );
  }
});
