import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { EXPERT_CAUSALITY_COPY, EXPERT_FINDING_REVIEW } = await import('@/config/expert-causality');
const { updateExpertBlock, updateExpertFindings } = await import('@/lib/expert-causality');
const { gridErrorSources } = await import('@/lib/grid-view');
const { validateExpertBlockCauses } = await import('@/lib/expert');

function block(id, status, followsFromBlockIds = []) {
  return {
    id,
    status,
    followsFromBlockIds,
    kind: 'math',
    title: id,
    formulas: [id],
    explanation: id,
  };
}

function reviews(blocks) {
  return blocks.map(({ id, status, followsFromBlockIds }) => ({ id, status, followsFromBlockIds }));
}

function assertRootReferences(blocks) {
  const earlierErrors = new Set();
  for (const current of blocks) {
    assert.equal(new Set(current.followsFromBlockIds).size, current.followsFromBlockIds.length);
    for (const id of current.followsFromBlockIds) assert.ok(earlierErrors.has(id));
    if (current.status !== 'follow_through') assert.deepEqual(current.followsFromBlockIds, []);
    if (current.status === 'error') earlierErrors.add(current.id);
  }
}

test('the visual cause picker offers only earlier error steps and no choices for an unknown step', () => {
  const task = {
    blocks: [
      block('correct', 'correct'),
      block('first-error', 'error'),
      block('warning', 'warning'),
      block('inherited', 'follow_through', ['first-error']),
      block('second-error', 'error'),
      block('current', 'follow_through', ['first-error', 'second-error']),
      block('future-error', 'error'),
    ],
  };

  assert.deepEqual(
    gridErrorSources(task, 'current').map((candidate) => candidate.id),
    ['first-error', 'second-error'],
  );
  assert.deepEqual(gridErrorSources(task, 'first-error'), []);
  assert.deepEqual(gridErrorSources(task, 'missing'), []);
});

test('editor and saved task share cause validation for empty, current, future and incompatible steps', () => {
  const current = block('current', 'follow_through', ['first-error', 'second-error']);
  const task = {
    blocks: [
      block('first-error', 'error'),
      block('correct', 'correct'),
      block('second-error', 'error'),
      current,
      block('future-error', 'error'),
    ],
  };

  assert.equal(validateExpertBlockCauses(task, current), null);
  for (const causes of [[], ['missing'], ['current'], ['future-error'], ['correct']]) {
    assert.notEqual(
      validateExpertBlockCauses(task, { ...current, followsFromBlockIds: causes }),
      null,
    );
  }
  assert.notEqual(validateExpertBlockCauses(task, { ...current, status: 'correct' }), null);
  assert.equal(
    validateExpertBlockCauses(task, { ...current, status: 'error', followsFromBlockIds: [] }),
    null,
  );
});

test('correcting a common cause promotes the first consequence and rebases later consequences', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['A']),
  ];
  const snapshot = structuredClone(input);
  const result = updateExpertBlock(input, {
    ...input[0],
    status: 'correct',
    explanation: 'OCR исправлен',
  });

  assert.deepEqual(
    reviews(result),
    reviews([block('A', 'correct'), block('B', 'error'), block('C', 'follow_through', ['B'])]),
  );
  assert.equal(result[1].explanation, EXPERT_CAUSALITY_COPY.promoted);
  assert.equal(result[2].explanation, EXPERT_CAUSALITY_COPY.rebased);
  assert.equal(result[0].explanation, 'OCR исправлен');
  assert.deepEqual(input, snapshot);
  assertRootReferences(result);
});

test('immediate links resolve through their current root after a correction', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['B']),
    block('D', 'follow_through', ['C']),
  ];
  const result = updateExpertBlock(input, { ...input[0], status: 'correct' });

  assert.deepEqual(
    reviews(result),
    reviews([
      block('A', 'correct'),
      block('B', 'error'),
      block('C', 'follow_through', ['B']),
      block('D', 'follow_through', ['B']),
    ]),
  );
  assertRootReferences(result);
});

test('a content edit normalizes immediate links without changing mathematical reviews', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['B']),
  ];
  const result = updateExpertBlock(input, { ...input[0], formulas: ['x=3'] });

  assert.deepEqual(result[0].formulas, ['x=3']);
  assert.deepEqual(result[2].followsFromBlockIds, ['A']);
  assert.equal(result[2].status, 'follow_through');
  assert.equal(result[2].explanation, input[2].explanation);
  assertRootReferences(result);
});

test('independent errors and their descendants remain unchanged', () => {
  const input = [
    block('A', 'error'),
    block('X', 'error'),
    block('B', 'follow_through', ['A']),
    block('Y', 'follow_through', ['X']),
    block('C', 'follow_through', ['A']),
    block('Z', 'correct'),
  ];
  const result = updateExpertBlock(input, { ...input[0], status: 'correct' });

  for (const index of [1, 3, 5]) assert.equal(result[index], input[index]);
  assert.deepEqual(result[4].followsFromBlockIds, ['B']);
  assertRootReferences(result);
});

test('multiple causes retain surviving roots without promoting a still-explained consequence', () => {
  const input = [
    block('A', 'error'),
    block('X', 'error'),
    block('B', 'follow_through', ['A', 'X']),
    block('C', 'follow_through', ['A']),
    block('D', 'follow_through', ['A', 'X']),
  ];
  const result = updateExpertBlock(input, { ...input[0], status: 'correct' });

  assert.equal(result[2].status, 'follow_through');
  assert.deepEqual(result[2].followsFromBlockIds, ['X']);
  assert.equal(result[3].status, 'error');
  assert.deepEqual(result[4].followsFromBlockIds, ['C', 'X']);
  assertRootReferences(result);
});

test('correcting an intermediate step promotes only its explicit descendants', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['B']),
    block('D', 'follow_through', ['A']),
    block('E', 'follow_through', ['B']),
  ];
  const result = updateExpertBlock(input, { ...input[1], status: 'correct' });

  assert.equal(result[2].status, 'error');
  assert.deepEqual(result[3].followsFromBlockIds, ['A']);
  assert.deepEqual(result[4].followsFromBlockIds, ['C']);
  assertRootReferences(result);
});

test('successive corrections move the cause forward and never leave a correct cause', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['A']),
  ];
  const first = updateExpertBlock(input, { ...input[0], status: 'correct' });
  const second = updateExpertBlock(first, { ...first[1], status: 'correct' });
  const third = updateExpertBlock(second, { ...second[2], status: 'correct' });

  assert.equal(second[2].status, 'error');
  assert.ok(third.every((current) => current.status === 'correct'));
  assertRootReferences(third);
});

test('changing a root into a consequence rebases descendants to its new actual root', () => {
  const input = [block('X', 'error'), block('A', 'error'), block('B', 'follow_through', ['A'])];
  const result = updateExpertBlock(input, {
    ...input[1],
    status: 'follow_through',
    followsFromBlockIds: ['X'],
  });

  assert.deepEqual(result[1].followsFromBlockIds, ['X']);
  assert.deepEqual(result[2].followsFromBlockIds, ['X']);
  assert.equal(result[2].status, 'follow_through');
  assertRootReferences(result);
});

test('dangling, forward, cyclic, duplicate and correct references never survive normalization', () => {
  const input = [
    block('A', 'follow_through', ['B']),
    block('B', 'follow_through', ['A']),
    block('X', 'error'),
    block('C', 'correct'),
    block('D', 'follow_through', ['missing', 'D', 'C', 'X', 'X', 'A']),
  ];
  const result = updateExpertBlock(input, { ...input[4], explanation: 'Проверь причину' });

  assert.deepEqual(result[0].followsFromBlockIds, []);
  assert.deepEqual(result[1].followsFromBlockIds, []);
  assert.deepEqual(result[4].followsFromBlockIds, ['X']);
  assertRootReferences(result);
});

test('invalid manual follow-through stays unresolved instead of inventing an error', () => {
  const input = [block('A', 'correct'), block('B', null)];
  const result = updateExpertBlock(input, {
    ...input[1],
    status: 'follow_through',
    followsFromBlockIds: ['A'],
    explanation: 'Ручная заметка',
  });

  assert.equal(result[1].status, 'follow_through');
  assert.deepEqual(result[1].followsFromBlockIds, []);
  assert.equal(result[1].explanation, 'Ручная заметка');
  assertRootReferences(result);
});

test('warning and unchecked root changes require a cause decision, not an invented correction', () => {
  for (const status of ['warning', null]) {
    const input = [block('A', 'error'), block('B', 'follow_through', ['A'])];
    const result = updateExpertBlock(input, { ...input[0], status });

    assert.equal(result[1].status, 'follow_through');
    assert.deepEqual(result[1].followsFromBlockIds, []);
    assert.equal(result[1].explanation, EXPERT_CAUSALITY_COPY.missingCause);
    assertRootReferences(result);
  }
});

test('unknown edits leave the input intact and absent optional metadata stays absent', () => {
  const input = [block('A', 'correct')];
  delete input[0].followsFromBlockIds;

  assert.equal(updateExpertBlock(input, block('missing', 'error')), input);
  assert.deepEqual(updateExpertBlock(input, input[0]), input);
});

test('findings follow the promoted root, preserve their original description and leave independent remarks intact', () => {
  const input = [
    block('A', 'error'),
    block('B', 'follow_through', ['A']),
    block('C', 'follow_through', ['A']),
    block('X', 'error'),
  ];
  const findings = [
    {
      id: 'a',
      blockId: 'A',
      kind: 'error',
      title: 'Исходная ошибка',
      description: 'Исходное описание',
      deduction: 1,
    },
    {
      id: 'x',
      blockId: 'X',
      kind: 'error',
      title: 'Независимая ошибка',
      description: 'Другой разбор',
      deduction: 1,
    },
    {
      id: 'warning',
      blockId: 'A',
      kind: 'warning',
      title: 'Совет',
      description: 'Сохрани запись',
      deduction: 0,
    },
  ];
  const snapshot = structuredClone(findings);
  const after = updateExpertBlock(input, { ...input[0], status: 'correct' });
  const moved = updateExpertFindings(input, after, findings, 'A');

  assert.equal(moved[0].blockId, 'B');
  assert.equal(moved[0].title, EXPERT_FINDING_REVIEW.title);
  assert.equal(
    moved[0].description,
    `${EXPERT_FINDING_REVIEW.moved}\n\n${findings[0].description}`,
  );
  assert.equal(moved[1], findings[1]);
  assert.equal(moved[2], findings[2]);
  assert.deepEqual(findings, snapshot);
  const next = updateExpertBlock(after, { ...after[1], status: 'correct' });
  const movedAgain = updateExpertFindings(after, next, moved, 'B');
  assert.equal(movedAgain[0].blockId, 'C');
  assert.equal(movedAgain[0].description, moved[0].description);
});

test('correcting the last root keeps the finding available and marks its relevance for review', () => {
  const input = [block('A', 'error')];
  const finding = {
    id: 'a',
    blockId: 'A',
    title: 'Ошибка',
    description: 'Полный разбор',
    deduction: 1,
  };
  const after = updateExpertBlock(input, { ...input[0], status: 'correct' });
  const [marked] = updateExpertFindings(input, after, [finding], 'A');

  assert.equal(marked.blockId, 'A');
  assert.equal(marked.title, EXPERT_FINDING_REVIEW.title);
  assert.equal(marked.description, `${EXPERT_FINDING_REVIEW.corrected}\n\n${finding.description}`);
  assert.equal(updateExpertFindings(input, input, [finding], 'A')[0], finding);
});
