import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import { hookHarness, moduleLoader } from './helpers/hook-harness.mjs';

const load = moduleLoader();
const {
  tokenizeGridRichText,
  serializeGridRichText,
  editGridRichTextSegment,
  encloseGridRichTextTail,
  isGridMathStatement,
} = load('@/lib/grid-rich-text');

test('mixed OCR text preserves delimiters, CRLF and whitespace exactly', () => {
  const examples = [
    '',
    'Обычный текст без формулы',
    'Получаем $x=2$, затем \\(x+1=3\\)\nОтвет: \\[x=2\\]',
    '  $$  \\frac{1}{2} \r\n + x $$  \r\n',
    'До $x$ между $$y$$ после \\(z\\)',
    '\\(\\) и $$$$',
    'Цена \\$5, формула $x+1$ и \\\\(не формула\\)',
    'Решение\n  \\frac{x+1}{2} \\ge 3  \r\nОтвет',
    '\\begin{cases}x>0\\\\x<2\\end{cases}\n',
  ];

  for (const source of examples) {
    assert.equal(serializeGridRichText(tokenizeGridRichText(source)), source, source);
  }
});

test('explicit math segments keep inline and display roles and can be edited losslessly', () => {
  const source = 'Дано $x$ и \\[y^2\\], ответ \\(z\\)';
  const segments = tokenizeGridRichText(source);
  const math = segments.filter((segment) => segment.kind === 'math');

  assert.deepEqual(
    math.map(({ value, displayMode }) => ({ value, displayMode })),
    [
      { value: 'x', displayMode: false },
      { value: 'y^2', displayMode: true },
      { value: 'z', displayMode: false },
    ],
  );
  math[1].value = '\\frac{1}{2}';
  assert.equal(serializeGridRichText(segments), 'Дано $x$ и \\[\\frac{1}{2}\\], ответ \\(z\\)');
});

test('escaped and incomplete delimiters stay literal without swallowing text', () => {
  for (const source of ['Остался $x+1', 'Не закрыто \\(x+1', '$$ x', '\\[x+1', 'Цена \\$5']) {
    const segments = tokenizeGridRichText(source);
    assert.equal(serializeGridRichText(segments), source);
    assert.ok(
      segments.every((segment) => segment.kind === 'text'),
      source,
    );
  }
  assert.equal(tokenizeGridRichText('$x+\\$+1$')[0].value, 'x+\\$+1');
});

test('bare TeX recognizes complete mathematical lines without turning prose into formulas', () => {
  const accepted = [
    '\\frac{1}{2}+x=0',
    '  \\sqrt{x^2+1}  ',
    '\\text{Ответ: }x=2',
    '\\begin{cases}x>0\\\\x<2\\end{cases}',
    'x+1=2',
    'x ≠ 0',
  ];
  const rejected = [
    'Ответ \\frac{1}{2}',
    '\\frac{1}{2} это дробь',
    '\\frac{1}{2} is a fraction',
    '\\Users\\folder',
    '\\frac{1}{2',
    'Получаем x=2',
    'Ответ: x > 0',
    'Solve x=2',
    'https://example.com/x?y=2',
    '<img src=x onerror=alert(1)>',
  ];

  for (const source of accepted)
    assert.equal(
      tokenizeGridRichText(source).filter((segment) => segment.kind === 'math').length,
      1,
      source,
    );
  for (const source of rejected)
    assert.ok(
      tokenizeGridRichText(source).every((segment) => segment.kind === 'text'),
      source,
    );
});

// Строки принятого AI example в commit 131fd79b1f9f253b598089eba6cc7d46ebe61659.
const aiBareLines = [
  't = 3^x, \\quad t > 0',
  't > 9',
  '3^x > 9 \\Rightarrow 3^x > 3^2 \\Rightarrow x > 2',
  'x \\in (2; +\\infty)',
];

test('accepted AI bare lines render as formulas and retain exact source serialization', () => {
  const renderer = moduleLoader({ katex: { default: katex } });
  const { ExpertRichText } = renderer('@/components/expert/ExpertRichText');

  for (const line of aiBareLines) {
    const source = `  ${line}  \r\n`;
    const segments = tokenizeGridRichText(source);
    const formulas = segments.filter((segment) => segment.kind === 'math');
    assert.equal(formulas.length, 1, line);
    assert.equal(formulas[0].value, line);
    assert.equal(formulas[0].opening, '');
    assert.equal(serializeGridRichText(segments), source);

    const html = renderToStaticMarkup(createElement(ExpertRichText, { value: line }));
    assert.match(html, /class="katex"/);
    assert.doesNotMatch(html, /katex-error/);
  }
});

test('expert finding titles render mixed TeX as formulas without exposing delimiters', () => {
  const renderer = moduleLoader({ katex: { default: katex } });
  const { ExpertVerdict } = renderer('@/components/expert/ExpertVerdict');
  const { EXPERT_MOCK_TASKS } = renderer('@/config/expert-mock');
  const task = structuredClone(EXPERT_MOCK_TASKS[0]);
  task.analysis = {
    ...task.analysis,
    verdict: 'Проверено',
    summary: '',
    advice: '',
    findings: [
      {
        id: 'live-finding',
        blockId: '',
        title:
          '$$\\frac{(t-3)^2}{(t-9)(t+9)} \\geq 0$$ и далее $$\\Rightarrow t>9$$ - вывод неверен',
        description: 'Нужно проверить отдельную точку',
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(ExpertVerdict, { task, workspace: { busy: false, dirty: false }, ui: {} }),
  );

  assert.equal((html.match(/class="katex"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /katex-error|\$\$/);
  assert.match(html, /и далее/);
  assert.match(html, /вывод неверен/);
});

test('step comment popovers render AI corrections through the shared math renderer', () => {
  const passthrough = ({ children }) => children;
  const renderer = moduleLoader({
    katex: { default: katex },
    '@base-ui/react/popover': {
      Popover: Object.fromEntries(
        ['Root', 'Trigger', 'Portal', 'Positioner', 'Popup', 'Close'].map((name) => [
          name,
          passthrough,
        ]),
      ),
    },
  });
  const { ExpertSolutionBlock } = renderer('@/components/expert/ExpertSolutionBlock');
  const explanation = String.raw`В знаменателе появился лишний множитель (x-1) [E05] Правильная запись: $$\frac{(x+1)^2(x-1)}{(2^{x^2}-4)^2} \geq 0;\quad 2^{x^2}-4 \text{ и } x^2-2 \text{ совпадают по знаку и нулям} \Rightarrow \frac{(x+1)^2(x-1)}{(x-\sqrt{2})^2(x+\sqrt{2})^2} \geq 0$$`;
  const html = renderToStaticMarkup(
    createElement(ExpertSolutionBlock, {
      block: {
        id: 'correction',
        kind: 'text',
        title: 'Преобразование',
        text: 'Исходная запись',
        status: 'error',
        explanation,
      },
      number: '01',
      selected: true,
      readOnly: true,
      onSelect: () => undefined,
      onRevealRelated: () => undefined,
      onEdit: () => undefined,
    }),
  );

  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /katex-error|\$\$/);
  assert.match(html, /В знаменателе появился лишний множитель/);
  assert.equal(serializeGridRichText(tokenizeGridRichText(explanation)), explanation);
});

test('the shared visual editor opens bare AI formulas and updates one without rewriting its neighbors', () => {
  const hooks = hookHarness();
  const editorLoad = moduleLoader({
    react: { ...hooks.react, useEffectEvent: (callback) => callback },
  });
  const { useGridRichTextEditor } = editorLoad('@/hooks/use-grid-rich-text-editor');
  const source = aiBareLines.join('\n');
  let edited;
  const editor = hooks.render(() => useGridRichTextEditor(source, (value) => (edited = value)));
  const formulas = editor.segments.filter((segment) => segment.kind === 'math');
  assert.deepEqual(
    formulas.map((segment) => segment.value),
    aiBareLines,
  );
  assert.equal(edited, undefined);

  editor.update(formulas[1].id, 't > 3');
  const expected = [...aiBareLines];
  expected[1] = 't > 3';
  assert.equal(edited, expected.join('\n'));
});

test('text and TeX containing markup render without executable HTML or trusted links', () => {
  const renderer = moduleLoader({
    katex: { default: katex },
    '@/config/layout': {
      UI_RADIUS_ROLES: load('@/config/layout').UI_RADIUS_ROLES,
      layout: { mathFormula: '', expertRichText: { root: '', inlineMath: '', displayMath: '' } },
    },
  });
  const { ExpertRichText } = renderer('@/components/expert/ExpertRichText');
  const value = '<script>alert(1)</script> $\\href{javascript:alert(1)}{x}$';
  const html = renderToStaticMarkup(createElement(ExpertRichText, { value }));

  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('href="javascript:'));
  assert.equal(serializeGridRichText(tokenizeGridRichText(value)), value);
});

test('edited bare formula and an appended segment retain their math role after a reload', () => {
  const bare = tokenizeGridRichText('\\frac{1}{2}');
  const changed = serializeGridRichText([editGridRichTextSegment(bare[0], 'x+1')]);
  assert.equal(tokenizeGridRichText(changed)[0].kind, 'math');
  assert.equal(tokenizeGridRichText(changed)[0].value, 'x+1');

  const appended = serializeGridRichText([
    ...encloseGridRichTextTail(bare),
    { kind: 'text', value: ' Ответ', opening: '', closing: '', displayMode: false },
  ]);
  assert.deepEqual(
    tokenizeGridRichText(appended).map((segment) => segment.kind),
    ['math', 'text'],
  );
});

test('task statement accepts a whole formula but keeps prose and delimited math in mixed rendering', () => {
  assert.equal(isGridMathStatement('x^2-5x+6\\leq0'), true);
  assert.equal(isGridMathStatement('\\sin x=\\frac12'), true);
  assert.equal(isGridMathStatement('Реши уравнение \\(x=2\\)'), false);
  assert.equal(isGridMathStatement('\\(x=2\\)'), false);
  assert.equal(isGridMathStatement('$x^2=2$'), false);
  assert.equal(isGridMathStatement('Solve x=2'), false);
});

const nativeDiagram = {
  kind: 'number_line_v2',
  variable: 't',
  note: null,
  points: [{ id: 'nine', value: '9', included: false, sign: null }],
  arcs: [{ from: 'nine', to: '+inf', selected: true, sign: '+' }],
};
const nativeDescription =
  '[числовая прямая: точка $$-9$$ выколота, точка $$0$$ закрашена; над промежутком $$(9;+\\infty)$$ знак $$+$$; штриховка справа от $$9$$]';
const nativeStep = {
  id: 'native-step',
  title: 'Шаг 1',
  kind: 'step',
  status: 'error',
  explanation: 'Проверь точку',
  lines: ['$$t=3^x$$', nativeDescription, '$$\\Rightarrow t>9$$'],
  diagram: nativeDiagram,
};

test('only a complete explicit native line description collapses with exact source roundtrip', () => {
  const { expertStepTextParts, replaceExpertStepTextPart } = load('@/lib/expert-step-text');
  const source = nativeStep.lines.join('\n');
  const parts = expertStepTextParts(source, nativeDiagram);
  const description = parts.find((part) => part.kind === 'description');
  assert.equal(description.value, nativeDescription);
  assert.equal(parts.map((part) => part.value).join(''), source);
  const changed = replaceExpertStepTextPart(parts, description.id, '[числовая прямая: уточнено]');
  assert.equal(
    changed.map((part) => part.value).join(''),
    ['$$t=3^x$$', '[числовая прямая: уточнено]', '$$\\Rightarrow t>9$$'].join('\n'),
  );

  for (const value of [
    'Упоминается числовая прямая: без маркера',
    'Сначала [числовая прямая: часть рассуждения]',
    '[числовая прямая: незакрыто',
    '[числовая прямая: незакрыто и вложенный [отрезок]',
    '$$\\text{[числовая прямая: внутри формулы]}$$',
  ]) {
    const plain = expertStepTextParts(value, nativeDiagram);
    assert.equal(plain.map((part) => part.value).join(''), value);
    assert.ok(
      plain.every((part) => part.kind === 'text'),
      value,
    );
  }
  for (const diagram of [undefined, { kind: 'unit_circle_v2', points: [], arcs: [] }])
    assert.ok(expertStepTextParts(source, diagram).every((part) => part.kind === 'text'));

  const sameLine = '[интервальная прямая: $$t\\in[0;9)$$] $$\\Rightarrow t>9$$';
  const inlineParts = expertStepTextParts(sameLine, nativeDiagram);
  assert.equal(inlineParts[0].kind, 'description');
  assert.equal(inlineParts[1].value, ' $$\\Rightarrow t>9$$');
  assert.equal(inlineParts.map((part) => part.value).join(''), sameLine);
});

test('shared step rendering keeps the diagram and neighboring formulas outside a closed description', () => {
  const renderer = moduleLoader({ katex: { default: katex } });
  const { ExpertBlockContent } = renderer('@/components/expert/ExpertBlockContent');
  const { ExpertSolutionBlock } = renderer('@/components/expert/ExpertSolutionBlock');
  const { EXPERT_SOLUTION_COPY } = renderer('@/config/expert-solution-layout');
  const html = renderToStaticMarkup(createElement(ExpertBlockContent, { block: nativeStep }));
  const beforeDescription = html.slice(0, html.indexOf('<details'));
  assert.match(html, /<details class=/);
  assert.doesNotMatch(html, /<details[^>]*\bopen[=> ]/);
  assert.ok(html.includes(EXPERT_SOLUTION_COPY.diagramDescription));
  assert.match(beforeDescription, /<svg/);
  assert.match(beforeDescription, /\\Rightarrow t&gt;9/);
  assert.ok(!beforeDescription.includes('штриховка справа'));
  assert.ok(html.includes('штриховка справа'));

  const expert = renderToStaticMarkup(
    createElement(ExpertSolutionBlock, {
      block: nativeStep,
      number: '01',
      selected: false,
      onSelect: () => undefined,
      onRevealRelated: () => undefined,
      onEdit: () => undefined,
    }),
  );
  assert.ok(expert.indexOf('</button>') < expert.indexOf('<details'));
  assert.equal((expert.match(/<details /g) ?? []).length, 1);
  assert.doesNotMatch(expert.slice(0, expert.indexOf('</button>')), /штриховка справа/);
});

test('description editor preserves neighboring OCR, validity and segment identity through edits', () => {
  const hooks = hookHarness();
  const editorLoad = moduleLoader({
    react: { ...hooks.react, useEffectEvent: (callback) => callback },
  });
  const { useExpertStepText } = editorLoad('@/hooks/use-expert-step-text');
  let source = nativeStep.lines.join('\n');
  let valid;
  const render = () =>
    hooks.render(() =>
      useExpertStepText(
        source,
        nativeDiagram,
        (next) => (source = next),
        (next) => (valid = next),
      ),
    );
  const editor = render();
  assert.equal(valid, false);
  for (const part of editor.parts) editor.setValidity(part.id, true);
  assert.equal(render().parts.length, 3);
  assert.equal(valid, true);
  const description = editor.parts.find((part) => part.kind === 'description');
  editor.update(description.id, description.value.replace('выколота', 'закрашена'));
  const next = render();
  assert.deepEqual(source.split('\n'), [
    nativeStep.lines[0],
    nativeDescription.replace('выколота', 'закрашена'),
    nativeStep.lines[2],
  ]);
  assert.equal(next.parts.find((part) => part.kind === 'description').id, description.id);
  next.setValidity(description.id, false);
  render();
  assert.equal(valid, false);
});

test('step editor keeps description fields in a closed disclosure while adjacent formulas remain editable', () => {
  const renderer = moduleLoader({
    '@/hooks/use-expert-step-text': {
      useExpertStepText: (value, diagram) => ({
        parts: load('@/lib/expert-step-text').expertStepTextParts(value, diagram),
        update: () => undefined,
        setValidity: () => undefined,
      }),
    },
    '@/components/expert/ExpertRichTextEditor': {
      ExpertRichTextEditor: ({ value }) => createElement('textarea', { defaultValue: value }),
    },
  });
  const { ExpertStepTextEditor } = renderer('@/components/expert/ExpertStepTextEditor');
  const html = renderToStaticMarkup(createElement(ExpertStepTextEditor, { block: nativeStep }));
  assert.doesNotMatch(html, /<details[^>]*\bopen[=> ]/);
  const description = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
  assert.match(description, /<textarea>/);
  assert.ok(description.includes('штриховка справа'));
  assert.ok(!description.includes('\\Rightarrow'));
  assert.match(html.slice(html.indexOf('</details>')), /\\Rightarrow t&gt;9/);
});
