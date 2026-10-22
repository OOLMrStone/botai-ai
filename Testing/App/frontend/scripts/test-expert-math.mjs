import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import katex from 'katex';
import { convertLatexToMarkup, validateLatex } from 'mathlive/ssr';

const { EXPERT_MATH, EXPERT_MATH_SYMBOL_GROUPS } = await import('@/config/expert-math');
const symbols = EXPERT_MATH_SYMBOL_GROUPS.flatMap((group) => group.symbols);

function checkFormula(latex, context) {
  assert.deepEqual(validateLatex(latex), [], `MathLive: ${context}`);
  assert.doesNotThrow(
    () => katex.renderToString(latex, { throwOnError: true }),
    `KaTeX: ${context}`,
  );
  assert.match(convertLatexToMarkup(latex), /ML__/, `Empty preview: ${context}`);
}

test('every palette icon renders in KaTeX and its completed insertion is valid in MathLive', () => {
  for (const symbol of symbols) {
    checkFormula(symbol.preview, symbol.id);
    checkFormula(symbol.insert.replace(/#(?:@|\?|0)/g, 'x'), `${symbol.id} insertion`);
  }
});

test('templates accept an existing expression without breaking delimiters or environments', () => {
  for (const symbol of symbols.filter((candidate) => /#(?:@|0)/.test(candidate.insert))) {
    const expression = symbol.insert.replace(/#(?:@|0)/g, '{3x+2}').replaceAll('#?', 'n');
    checkFormula(expression, `${symbol.id} selected expression`);
  }
});

test('systems, interval answers, vectors and number-theory expressions survive both renderers', () => {
  for (const expression of [
    '\\begin{cases}x+a>0\\\\x^2-a=0\\end{cases}',
    'x\\in(-\\infty;-2]\\cup[3;+\\infty)',
    '\\overrightarrow{AB}\\perp\\overrightarrow{CD}',
    '\\angle ABC=60^{\\circ}',
    'n\\in\\mathbb{Z},\\quad n\\equiv1\\pmod{3}',
    '\\operatorname{tg}(\\alpha)=\\frac{\\sin\\alpha}{\\cos\\alpha}',
  ])
    checkFormula(expression, expression);
});

test('quick access reuses the full catalog and no symbol is lost or listed twice', () => {
  assert.equal(new Set(symbols.map((symbol) => symbol.id)).size, symbols.length);
  for (const symbol of EXPERT_MATH.presets) {
    assert.ok(symbols.includes(symbol), `${symbol.id} is missing from the full palette`);
  }
  assert.ok(
    EXPERT_MATH_SYMBOL_GROUPS.findIndex((group) => group.id === 'functions') <
      EXPERT_MATH_SYMBOL_GROUPS.findIndex((group) => group.id === 'signs'),
  );
});

const {
  createMathStructureReader,
  deleteEmptyMathDelimiter,
  deleteEmptyMathStructure,
  insertMathStructureRow,
} = await import('@/lib/expert-math-structure');

function structureField(nodes, position) {
  const calls = [];
  return {
    calls,
    value: 'snapshot',
    position,
    selection: { ranges: [[position, position]] },
    lastOffset: nodes.length - 1,
    getElementInfo: (offset) => nodes[offset],
    getValue: (range) => {
      calls.push(['getValue', range]);
      return nodes[range[1]].latex;
    },
    executeCommand(command, ...args) {
      calls.push([command, ...args]);
      return true;
    },
    insert(contents, options) {
      calls.push(['insert', contents, options]);
      return true;
    },
  };
}

function assertDeletedRange(field, range, baselineRange = range) {
  assert.deepEqual(field.selection.ranges, [range]);
  assert.deepEqual(field.calls, [
    ['getValue', baselineRange],
    [
      'insert',
      field.getElementInfo(baselineRange[1]).latex,
      {
        insertionMode: 'replaceSelection',
        selectionMode: 'after',
        format: 'latex',
        silenceNotifications: true,
      },
    ],
    ['selectGroup'],
    ['insert', '', { insertionMode: 'replaceSelection', selectionMode: 'after', format: 'latex' }],
  ]);
}

const emptySystemNodes = [
  { depth: 0, latex: '' },
  { depth: 0, latex: 'a' },
  { depth: 0, latex: '+' },
  { depth: 1, latex: '' },
  { depth: 1, latex: '\\placeholder{}' },
  { depth: 1, latex: '' },
  { depth: 1, latex: '\\placeholder{}' },
  { depth: 0, latex: '\\begin{cases}\\placeholder{}\\\\\\placeholder{}\\end{cases}' },
  { depth: 0, latex: '+' },
  { depth: 0, latex: 'b' },
];

test('Backspace removes only the empty system after leaving its final placeholder', () => {
  const field = structureField(emptySystemNodes, 7);
  const structure = createMathStructureReader(field)();
  assert.equal(structure.kind, 'system');
  assert.equal(structure.empty, true);
  assert.deepEqual(structure.range, [2, 7]);
  assert.equal(deleteEmptyMathStructure(field, structure), true);
  assertDeletedRange(field, [2, 7], [5, 6]);
});

test('Backspace does not consume a non-empty system or a selection spanning its neighbor', () => {
  const field = structureField(
    emptySystemNodes.map((node, index) => (index === 4 ? { ...node, latex: 'x' } : node)),
    7,
  );
  const read = createMathStructureReader(field);
  assert.equal(deleteEmptyMathStructure(field, read()), false);
  field.selection = { ranges: [[1, 7]] };
  assert.equal(read(), null);
  assert.deepEqual(field.calls, []);
});

test('Enter adds a collection row without moving outside its bracket or into adjacent formulas', () => {
  const nodes = [
    { depth: 0, latex: '' },
    { depth: 0, latex: 'a' },
    { depth: 0, latex: '+' },
    { depth: 1, latex: '' },
    { depth: 2, latex: '' },
    { depth: 2, latex: 'x' },
    { depth: 2, latex: '' },
    { depth: 2, latex: 'y' },
    { depth: 1, latex: '\\begin{gathered}x\\\\y\\end{gathered}' },
    { depth: 0, latex: '\\left[\\begin{gathered}x\\\\y\\end{gathered}\\right.' },
    { depth: 0, latex: '+' },
    { depth: 0, latex: 'b' },
  ];
  const field = structureField(nodes, 5);
  const structure = createMathStructureReader(field)();
  assert.equal(structure.kind, 'collection');
  assert.deepEqual(structure.range, [2, 9]);
  assert.equal(insertMathStructureRow(field, structure), true);
  assert.equal(field.position, 5);
  assert.deepEqual(field.calls, [['insert', '\\\\', undefined]]);
});

test('Enter uses the native row-break insertion only while the cursor is inside a row', () => {
  const field = structureField(emptySystemNodes, 3);
  const structure = createMathStructureReader(field)();
  assert.equal(insertMathStructureRow(field, structure), true);
  assert.equal(field.position, 4);
  assert.deepEqual(field.calls, [['insert', '\\\\', undefined]]);
  const outside = structureField(emptySystemNodes, 7);
  assert.equal(insertMathStructureRow(outside, createMathStructureReader(outside)()), false);
  assert.deepEqual(outside.calls, []);
});

test('deleting the final row removes the wrapper rather than leaving an undeletable empty shell', () => {
  const field = structureField(
    [
      ...emptySystemNodes.slice(0, 5),
      { depth: 0, latex: '\\begin{cases}\\placeholder{}\\end{cases}' },
      ...emptySystemNodes.slice(8),
    ],
    4,
  );
  assert.equal(deleteEmptyMathStructure(field, createMathStructureReader(field)()), true);
  assertDeletedRange(field, [2, 5], [3, 4]);
});

test('an empty gathered block never takes ownership of adjacent content inside the same bracket', () => {
  const emptyRows = [
    { depth: 2, latex: '' },
    { depth: 2, latex: '\\placeholder{}' },
    { depth: 2, latex: '' },
    { depth: 2, latex: '\\placeholder{}' },
    { depth: 1, latex: '\\begin{gathered}\\placeholder{}\\\\\\placeholder{}\\end{gathered}' },
  ];
  const sibling = [
    { depth: 1, latex: '+' },
    { depth: 1, latex: '3' },
  ];
  for (const siblingBefore of [false, true]) {
    const nodes = [
      { depth: 0, latex: '' },
      { depth: 1, latex: '' },
      ...(siblingBefore ? sibling : []),
      ...emptyRows,
      ...(siblingBefore ? [] : sibling),
      {
        depth: 0,
        latex:
          '\\left[\\begin{gathered}\\placeholder{}\\\\\\placeholder{}\\end{gathered}+3\\right.',
      },
    ];
    const arrayStart = siblingBefore ? 3 : 1;
    const arrayEnd = arrayStart + emptyRows.length;
    const field = structureField(nodes, arrayEnd);
    const structure = createMathStructureReader(field)();
    assert.equal(structure.kind, 'rows');
    assert.deepEqual(structure.range, [arrayStart, arrayEnd]);
    assert.equal(deleteEmptyMathStructure(field, structure), true);
    assertDeletedRange(field, [arrayStart, arrayEnd], [arrayEnd - 2, arrayEnd - 1]);
  }
});

function casesField(initialRows, currentRow) {
  let rows = [...initialRows];
  const calls = [];
  const snapshot = () => {
    const nodes = [
      { depth: 0, latex: '' },
      { depth: 0, latex: '7' },
      { depth: 0, latex: '+' },
    ];
    const ranges = rows.map((latex) => {
      const start = nodes.length;
      nodes.push({ depth: 1, latex: '' });
      for (const symbol of latex.startsWith('\\placeholder') ? [latex] : [...latex])
        nodes.push({ depth: 1, latex: symbol });
      return [start, nodes.length - 1];
    });
    const array = `\\begin{cases}${rows.join('\\\\')}\\end{cases}`;
    nodes.push({ depth: 0, latex: array });
    return { nodes, ranges, array };
  };
  const field = {
    calls,
    selection: { ranges: [snapshot().ranges[currentRow]] },
    get value() {
      return `7+${rows.length ? snapshot().array : ''}`;
    },
    get lastOffset() {
      return snapshot().nodes.length - 1;
    },
    get position() {
      return this.selection.ranges[0][1];
    },
    set position(position) {
      this.selection = { ranges: [[position, position]] };
    },
    getElementInfo: (offset) => snapshot().nodes[offset],
    getValue(range) {
      calls.push(['getValue', [...range]]);
      const state = snapshot();
      if (range[0] === 2 && range[1] === state.nodes.length - 1) return state.array;
      const index = state.ranges.findIndex(
        ([start, end]) => start === range[0] && end === range[1],
      );
      assert.notEqual(index, -1, 'only an exact row or its array may be serialized');
      return rows[index];
    },
    executeCommand(command) {
      calls.push([command]);
      if (command !== 'removeRow') return true;
      const index = snapshot().ranges.findIndex(
        ([start, end]) => this.position >= start && this.position <= end,
      );
      if (index < 0) return false;
      rows.splice(index, 1);
      this.position = snapshot().ranges[Math.max(0, index - 1)][1];
      return true;
    },
    insert(contents, options) {
      const range = this.selection.ranges[0];
      const state = snapshot();
      calls.push(['insert', contents, [...range], options]);
      if (range[0] === 2 && range[1] === state.nodes.length - 1) {
        if (!contents) rows = [];
        // MathLive 0.110 normalizeCells удаляет пустой хвост cases при повторном разборе.
        else if (rows.at(-1) === '') rows.pop();
        this.position = this.lastOffset;
        return true;
      }
      const index = state.ranges.findIndex(
        ([start, end]) => start === range[0] && end === range[1],
      );
      assert.notEqual(index, -1, 'replacement must stay inside a known cell');
      rows[index] = contents;
      this.position = snapshot().ranges[index][1];
      return true;
    },
  };
  return field;
}

test('empty cases row deletion records cells without triggering trailing-row normalization', () => {
  for (const [rows, row, expected] of [
    [['x=1', 'x=2', ''], 2, '7+\\begin{cases}x=1\\\\x=2\\end{cases}'],
    [['', 'x=2', ''], 0, '7+\\begin{cases}x=2\\\\\\end{cases}'],
  ]) {
    const field = casesField(rows, row);
    assert.equal(deleteEmptyMathStructure(field, createMathStructureReader(field)()), true);
    assert.equal(field.value, expected);
    assert.equal(field.calls.filter(([command]) => command === 'removeRow').length, 1);
    assert.equal(
      field.calls.some(([command, value]) => command === 'insert' && value.startsWith('\\begin')),
      false,
    );
    const baseline = field.calls.find(([command]) => command === 'insert');
    assert.equal(baseline[1], '\\placeholder{}');
    assert.equal(baseline[3].silenceNotifications, false);
    assert.ok(createMathStructureReader(field)(), 'caret remains inside the preserved system');
  }
});

test('the final empty cases row is materialized before removing the exact resized wrapper', () => {
  const field = casesField([''], 0);
  assert.equal(deleteEmptyMathStructure(field, createMathStructureReader(field)()), true);
  assert.equal(field.value, '7+');
  assert.deepEqual(field.calls.at(-1).slice(0, 3), ['insert', '', [2, 5]]);
  assert.deepEqual(field.calls[0], ['getValue', [3, 3]]);
});

test('a non-empty row or a selection spanning rows never triggers row removal', () => {
  const nodes = emptySystemNodes.map((node, index) =>
    index === 4 ? { ...node, latex: '3' } : node,
  );
  const field = structureField(nodes, 4);
  const read = createMathStructureReader(field);
  assert.equal(deleteEmptyMathStructure(field, read()), false);
  field.selection = { ranges: [[3, 6]] };
  assert.equal(deleteEmptyMathStructure(field, read()), false);
  assert.deepEqual(field.calls, []);
});

test('an empty cell never removes a row with a filled second column', () => {
  const field = structureField(
    [
      { depth: 0, latex: '' },
      { depth: 1, latex: '' },
      { depth: 1, latex: '\\placeholder{}' },
      { depth: 1, latex: '' },
      { depth: 1, latex: '3' },
      { depth: 0, latex: '\\begin{cases}\\placeholder{}&3\\end{cases}' },
    ],
    2,
  );
  const structure = createMathStructureReader(field)();
  assert.equal(structure.rows, null);
  assert.equal(deleteEmptyMathStructure(field, structure), false);
  assert.deepEqual(field.calls, []);
});

test('a native no-op still consumes Backspace instead of deleting the entire multi-row structure', () => {
  const field = structureField(emptySystemNodes, 4);
  assert.equal(deleteEmptyMathStructure(field, createMathStructureReader(field)()), true);
  assert.deepEqual(field.calls.at(-1), ['removeRow']);
  assert.equal(
    field.calls.some(([command, value]) => command === 'insert' && value === ''),
    false,
  );
});

test('Backspace removes empty paired delimiters as a unit without touching adjacent numbers', () => {
  for (const latex of [
    '\\left(\\placeholder{}\\right)',
    '\\left[\\placeholder{}\\right]',
    '\\left\\{\\placeholder{}\\right\\}',
    '\\left\\lbrace\\placeholder{}\\right\\rbrace',
  ]) {
    const field = structureField(
      [
        { depth: 0, latex: '' },
        { depth: 0, latex: '7' },
        { depth: 0, latex: '+' },
        { depth: 1, latex: '' },
        { depth: 1, latex: '\\placeholder{}' },
        { depth: 0, latex },
        { depth: 0, latex: '+' },
        { depth: 0, latex: '3' },
      ],
      5,
    );
    assert.equal(deleteEmptyMathDelimiter(field), true);
    assertDeletedRange(field, [2, 5]);
  }
});

test('nested empty delimiters delete the innermost pair and leave filled pairs to MathLive', () => {
  const nodes = [
    { depth: 0, latex: '' },
    { depth: 1, latex: '' },
    { depth: 2, latex: '' },
    { depth: 2, latex: '\\placeholder{}' },
    { depth: 1, latex: '\\left[\\placeholder{}\\right]' },
    { depth: 0, latex: '\\left(\\left[\\placeholder{}\\right]\\right)' },
  ];
  const field = structureField(nodes, 5);
  assert.equal(deleteEmptyMathDelimiter(field), true);
  assert.deepEqual(field.selection.ranges, [[1, 4]]);
  const filled = structureField(
    nodes.map((node, index) => (index === 3 ? { ...node, latex: '3' } : node)),
    5,
  );
  assert.equal(deleteEmptyMathDelimiter(filled), false);
  assert.deepEqual(filled.calls, []);
});
