import './register-typescript.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { EXPERT } = await import('@/config/expert');
const { expertDocument, expertWorkFromDto, expertTaskToCanonical } =
  await import('@/lib/expert-adapter');
const { validateExpertDiagram, validateExpertTask } = await import('@/lib/expert');

// Прямая из принятого AI docs/grading/expert-json-example.json, kind заменён на canonical type.
const numberLine = {
  type: 'number_line_v2',
  variable: 't',
  note: 'При t > 0',
  points: [
    { id: 'p1', value: '-9', included: false, sign: null },
    { id: 'p2', value: '0', included: null, sign: null, bound: true },
    { id: 'p3', value: '3', included: true, sign: '0' },
    { id: 'p4', value: '9', included: false, sign: null },
  ],
  arcs: [
    { from: 'p2', to: 'p3', sign: '-', selected: false },
    { from: 'p3', to: 'p4', sign: '-', selected: false },
    { from: 'p4', to: '+inf', sign: '+', selected: true },
  ],
};

const circle = {
  type: 'unit_circle_v2',
  points: [
    { id: 'a', value: '\\frac{\\pi}{3}', included: true, sign: '0' },
    { id: 'b', value: '-π/2', included: false, sign: '-', bound: false },
  ],
  arcs: [
    { from: 'a', to: 'b', sign: '+', selected: true, direction: 'cw', full_circle: false },
    { from: 'b', to: 'b', sign: null, selected: false, direction: 'ccw', full_circle: true },
  ],
};

function nativeWork(diagram) {
  const document = {
    schema_version: 'expert-review.v2',
    origin: 'structured_ai',
    phase: 'graded',
    solution_image_ids: ['photo'],
    ocr: {
      blocks: [
        { id: 'root', sources: [], content: { type: 'text', text: 'Исходная ошибка' } },
        {
          id: 'observed',
          title: 'Метод интервалов',
          sources: [{ image_id: 'photo', bbox: { x: 0, y: 0.2, width: 1, height: 0.5 } }],
          content: { type: 'step', lines: [], diagram: structuredClone(diagram) },
        },
      ],
    },
    analysis: {
      block_reviews: [
        {
          block_id: 'root',
          status: 'error',
          explanation: 'Ошибка в записи',
          follows_from_block_ids: [],
        },
        {
          block_id: 'observed',
          status: 'follow_through',
          explanation: 'Следствие ошибки',
          follows_from_block_ids: ['root'],
        },
      ],
      findings: [
        {
          id: 'cause',
          block_ids: ['root'],
          kind: 'error',
          description: 'Ошибка',
          where: null,
          correct_version: null,
          advice: null,
          code: null,
          penalty: 1,
        },
      ],
      summary: 'Разбор',
      checks: null,
      student_answer: null,
      strengths: [],
    },
    grading: { score: 1, criterion: 'Критерий', explanation: 'Объяснение' },
    rejection_reason: null,
  };
  return {
    id: 'work',
    submissionId: 'submission',
    student: { id: 'student', firstName: 'Иван', lastName: 'Иванов', email: null, contact: null },
    taskNumber: 16,
    maxScore: 2,
    isDemo: false,
    status: 'queued',
    revision: 1,
    createdAt: '2026-10-16T10:00:00Z',
    updatedAt: '2026-10-16T10:00:00Z',
    task: {
      statement: 'Условие',
      content: null,
      referenceAnswer: 'Ответ',
      referenceSolution: null,
    },
    images: [
      {
        id: 'photo',
        fileName: 'solution.jpg',
        mimeType: 'image/jpeg',
        previewUrl: '/api/expert/works/work/images/photo',
      },
    ],
    aiResult: document,
    review: document,
    sentAt: null,
  };
}

function nativeView(diagram) {
  const { type, ...value } = structuredClone(diagram);
  return { kind: type, ...value };
}

test('real PR number line roundtrips sparse arcs, dashed bound, zero sign and omitted bound exactly', () => {
  const dto = nativeWork(numberLine);
  const task = expertWorkFromDto(dto).tasks[0];
  const step = task.blocks[1];
  assert.deepEqual(step.diagram, nativeView(numberLine));
  assert.equal(validateExpertTask(task), null);
  assert.deepEqual(expertTaskToCanonical(task), { ...dto.review, origin: 'expert' });
  assert.equal('bound' in step.diagram.points[0], false);
  assert.equal(step.diagram.points[1].included, null);
  assert.equal(step.diagram.arcs.length, 3);
});

test('observed labels and point order are never parsed, sorted or replaced by ordinal coordinates', () => {
  const diagram = structuredClone(numberLine);
  diagram.points[0].value = ' a + \\sqrt{2} ';
  diagram.points[2].value = '-20';
  diagram.points[3].bound = false;
  diagram.arcs.unshift({ from: 'p3', to: 'p3', sign: '0', selected: true });
  diagram.arcs.push({ from: '-inf', to: 'p1', sign: null, selected: false });
  const dto = nativeWork(diagram);
  const task = expertWorkFromDto(dto).tasks[0];
  assert.equal(validateExpertTask(task), null);
  assert.deepEqual(expertTaskToCanonical(task).ocr, dto.review.ocr);
  assert.deepEqual(
    task.blocks[1].diagram.points.map((point) => point.id),
    ['p1', 'p2', 'p3', 'p4'],
  );
});

test('circle retains raw expressions, point and arc signs, explicit direction and full circle', () => {
  const dto = nativeWork(circle);
  const task = expertWorkFromDto(dto).tasks[0];
  assert.deepEqual(task.blocks[1].diagram, nativeView(circle));
  assert.deepEqual(expertTaskToCanonical(task).ocr, dto.review.ocr);
  task.blocks[1].diagram.points[0].value = 'α + π';
  assert.equal(validateExpertTask(task), null);
  const saved = expertTaskToCanonical(task);
  assert.equal(saved.ocr.blocks[1].content.diagram.points[0].value, 'α + π');
  assert.deepEqual(saved.ocr.blocks[1].content.diagram.arcs, circle.arcs);
});

test('line-only and geometry edits retain source, title, single step identity and causal analysis', () => {
  for (const diagram of [numberLine, circle]) {
    const dto = nativeWork(diagram);
    const task = expertWorkFromDto(dto).tasks[0];
    const step = task.blocks[1];
    step.lines = ['Уточнённая строка $x=2$'];
    let saved = expertTaskToCanonical(task);
    assert.deepEqual(saved.ocr.blocks[1].content.diagram, diagram);
    step.diagram.points[0].value = '7';
    step.diagram.arcs[0].selected = !step.diagram.arcs[0].selected;
    saved = expertTaskToCanonical(task);
    assert.equal(saved.ocr.blocks.length, dto.review.ocr.blocks.length);
    assert.equal(saved.ocr.blocks[1].id, 'observed');
    assert.equal(saved.ocr.blocks[1].title, dto.review.ocr.blocks[1].title);
    assert.deepEqual(saved.ocr.blocks[1].sources, dto.review.ocr.blocks[1].sources);
    assert.deepEqual(saved.ocr.blocks[1].content.lines, step.lines);
    assert.deepEqual(saved.analysis, dto.review.analysis);
    assert.deepEqual(dto.review.ocr.blocks[1].content.diagram, diagram);
  }
});

test('native variants exist only in v2 step.diagram, never as standalone content or v1', () => {
  for (const diagram of [numberLine, circle]) {
    const dto = nativeWork(diagram);
    const task = expertWorkFromDto(dto).tasks[0];
    task.backend.document.schema_version = 'expert-review.v1';
    assert.throws(() => expertTaskToCanonical(task), { status: 502 });
    dto.review.schema_version = 'expert-review.v1';
    assert.throws(() => expertDocument(dto.review), { status: 502 });
    for (const schema of ['expert-review.v1', 'expert-review.v2']) {
      dto.review.schema_version = schema;
      dto.review.ocr.blocks[1].content = structuredClone(diagram);
      assert.throws(() => expertDocument(dto.review), { status: 502 });
    }
  }
});

test('native structural validation rejects invalid fields, bounds, signs and references without coercion', () => {
  const mutations = [
    (d) => {
      d.points[0].value = 2;
    },
    (d) => {
      d.points[0].value = ' ';
    },
    (d) => {
      d.points[0].id = '+inf';
    },
    (d) => {
      d.points[1].id = d.points[0].id;
    },
    (d) => {
      d.points[0].included = null;
    },
    (d) => {
      d.points[0].bound = null;
    },
    (d) => {
      d.points[0].sign = 'unknown';
    },
    (d) => {
      d.points[0].extra = 'unknown field';
    },
    (d) => {
      d.arcs[0].from = 'missing';
    },
    (d) => {
      d.arcs[0].to = null;
    },
    (d) => {
      d.arcs[0].sign = 0;
    },
    (d) => {
      d.arcs[0].selected = 'false';
    },
    (d) => {
      delete d.note;
    },
    (d) => {
      d.note = '';
    },
    (d) => {
      d.variable = '';
    },
    (d) => {
      d.extra = true;
    },
  ];
  for (const mutate of mutations) {
    const diagram = structuredClone(numberLine);
    mutate(diagram);
    assert.notEqual(validateExpertDiagram(nativeView(diagram)), null);
    assert.throws(() => expertWorkFromDto(nativeWork(diagram)), { status: 502 });
    const task = expertWorkFromDto(nativeWork(numberLine)).tasks[0];
    task.blocks[1].diagram = nativeView(diagram);
    assert.throws(() => expertTaskToCanonical(task), { status: 422 });
  }
});

test('circle requires explicit direction, exact full-circle semantics and finite endpoint membership', () => {
  const mutations = [
    (d) => {
      delete d.arcs[0].direction;
    },
    (d) => {
      d.arcs[0].direction = 'shortest';
    },
    (d) => {
      delete d.arcs[0].full_circle;
    },
    (d) => {
      d.arcs[0].full_circle = true;
    },
    (d) => {
      d.arcs[1].full_circle = false;
    },
    (d) => {
      d.arcs[0].from = '-inf';
    },
    (d) => {
      d.note = null;
    },
  ];
  for (const mutate of mutations) {
    const diagram = structuredClone(circle);
    mutate(diagram);
    assert.throws(() => expertWorkFromDto(nativeWork(diagram)), { status: 502 });
  }
});

test('native input limits are checked exactly and arrays need not form a complete partition', () => {
  const limits = EXPERT.nativeDiagram;
  const diagram = structuredClone(numberLine);
  diagram.note = 'н'.repeat(limits.maxNoteLength);
  diagram.variable = 't'.repeat(limits.maxVariableLength);
  diagram.points = Array.from({ length: limits.maxPoints }, (_, index) => ({
    id: String(index).padStart(limits.maxIdLength, 'p'),
    value: 'x'.repeat(limits.maxValueLength),
    included: false,
    sign: null,
  }));
  diagram.arcs = Array.from({ length: limits.maxArcs }, () => ({
    from: diagram.points[0].id,
    to: diagram.points[0].id,
    sign: null,
    selected: false,
  }));
  assert.equal(validateExpertDiagram(nativeView(diagram)), null);
  assert.doesNotThrow(() => expertWorkFromDto(nativeWork(diagram)));
  for (const mutate of [
    (d) => {
      d.points.push({ ...d.points[0], id: 'new' });
    },
    (d) => {
      d.arcs.push({ ...d.arcs[0] });
    },
    (d) => {
      d.points[0].id += 'p';
    },
    (d) => {
      d.points[0].value += 'x';
    },
    (d) => {
      d.note += 'н';
    },
    (d) => {
      d.variable += 't';
    },
  ]) {
    const oversized = structuredClone(diagram);
    mutate(oversized);
    assert.throws(() => expertWorkFromDto(nativeWork(oversized)), { status: 502 });
  }
  const empty = { type: 'number_line_v2', variable: 'x', note: null, points: [], arcs: [] };
  assert.deepEqual(
    expertTaskToCanonical(expertWorkFromDto(nativeWork(empty)).tasks[0]).ocr.blocks[1].content
      .diagram,
    empty,
  );
});
