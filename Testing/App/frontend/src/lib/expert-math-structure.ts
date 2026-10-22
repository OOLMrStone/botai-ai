import type { MathfieldElement, Range } from 'mathlive';

import { EXPERT_MATH_STRUCTURE } from '@/config/expert-math';

type StructureField = Pick<
  MathfieldElement,
  | 'value'
  | 'position'
  | 'selection'
  | 'lastOffset'
  | 'getElementInfo'
  | 'getValue'
  | 'executeCommand'
  | 'insert'
>;

interface MathNode {
  offset: number;
  depth: number;
  latex: string;
}

interface StructureRow {
  range: Range;
  empty: boolean;
}

export interface ExpertMathStructure {
  kind: 'system' | 'collection' | 'rows';
  range: Range;
  arrayRange: Range;
  empty: boolean;
  rows: StructureRow[] | null;
}

function nodeRange(nodes: MathNode[], node: MathNode): Range {
  let start = node.offset - 1;
  while (start > 0 && nodes[start].depth > node.depth) start -= 1;
  return [start, node.offset];
}

function readNodes(field: StructureField): MathNode[] {
  return Array.from({ length: field.lastOffset + 1 }, (_, offset) => {
    const info = field.getElementInfo(offset);
    return { offset, depth: info?.depth ?? 0, latex: info?.latex ?? '' };
  });
}

function emptyNodes(nodes: MathNode[]) {
  return nodes.every(
    (node) => !node.latex || node.latex.startsWith(EXPERT_MATH_STRUCTURE.placeholderPrefix),
  );
}

function readRows(nodes: MathNode[], array: MathNode, range: Range): StructureRow[] | null {
  const content = nodes.slice(range[0] + 1, range[1]);
  const starts = content.filter((node) => node.depth === array.depth + 1 && !node.latex);
  // Без публичных индексов ячеек удаляем только однозначную одноколоночную запись.
  if (
    array.latex.includes(EXPERT_MATH_STRUCTURE.columnSeparator) ||
    starts.length !== array.latex.split(EXPERT_MATH_STRUCTURE.rowBreak).length
  )
    return null;

  return starts.map((node, index) => {
    const end = (starts[index + 1]?.offset ?? range[1]) - 1;
    return { range: [node.offset, end], empty: emptyNodes(nodes.slice(node.offset + 1, end + 1)) };
  });
}

function readStructures(field: StructureField): ExpertMathStructure[] {
  const nodes = readNodes(field);

  return nodes.flatMap((node) => {
    const environment = EXPERT_MATH_STRUCTURE.environments.find((candidate) =>
      node.latex.startsWith(candidate.prefix),
    );
    if (!environment) return [];

    const arrayRange = nodeRange(nodes, node);
    const parent = nodes.slice(node.offset + 1).find((candidate) => candidate.depth < node.depth);
    const onlyContent =
      parent &&
      nodes
        .slice(nodeRange(nodes, parent)[0] + 1, parent.offset)
        .every(
          (child) => child.depth !== node.depth || !child.latex || child.offset === node.offset,
        );
    const wrapper =
      parent &&
      onlyContent &&
      parent.depth === node.depth - 1 &&
      EXPERT_MATH_STRUCTURE.collectionPrefixes.some((prefix) => parent.latex.startsWith(prefix)) &&
      parent.latex.endsWith(EXPERT_MATH_STRUCTURE.openRightDelimiter)
        ? parent
        : undefined;
    const range = wrapper ? nodeRange(nodes, wrapper) : arrayRange;
    const empty = emptyNodes(nodes.slice(arrayRange[0] + 1, arrayRange[1]));

    return [
      {
        kind: wrapper ? 'collection' : environment.kind,
        range,
        arrayRange,
        empty,
        rows: readRows(nodes, node, arrayRange),
      },
    ];
  });
}

export function createMathStructureReader(field: StructureField) {
  let value: string | undefined;
  let structures: ExpertMathStructure[] = [];

  return () => {
    if (value !== field.value) {
      value = field.value;
      structures = readStructures(field);
    }
    const [selectionStart, selectionEnd] = field.selection.ranges[0];
    if (field.selection.ranges.length !== 1) return null;

    return (
      structures
        .filter(({ range }) => selectionStart > range[0] && selectionEnd <= range[1])
        .sort(
          (left, right) => left.range[1] - left.range[0] - (right.range[1] - right.range[0]),
        )[0] ?? null
    );
  };
}

function selectedRow(field: StructureField, structure: ExpertMathStructure) {
  const [start, end] = field.selection.ranges[0];
  return structure.rows?.find(({ range }) => start >= range[0] && end <= range[1]);
}

function deleteRange(field: StructureField, range: Range, emptyRow?: StructureRow) {
  const lastOffset = field.lastOffset;
  recordRangeState(field, emptyRow?.range ?? range, Boolean(emptyRow));
  // Команда выделения разделяет Undo-операции: соседние скобки имеют одинаковый тип вставки.
  field.executeCommand(EXPERT_MATH_STRUCTURE.commands.selectGroup);
  field.selection = { ranges: [[range[0], range[1] + field.lastOffset - lastOffset]] };
  field.insert('', { insertionMode: 'replaceSelection', selectionMode: 'after', format: 'latex' });
}

function recordRangeState(field: StructureField, range: Range, keepEmptyRow = false) {
  // Нативное удаление MathLive 0.110 не всегда сохраняет текущее состояние.
  // Вставка того же поддерева фиксирует его для Undo/Redo, не затрагивая соседей.
  const selection = field.selection;
  const contents = field.getValue(range);
  // Парсер cases отбрасывает последнюю полностью пустую строку, но сохраняет placeholder.
  const replacement = contents || (keepEmptyRow ? EXPERT_MATH_STRUCTURE.emptyPlaceholder : '');
  field.selection = { ranges: [range] };
  field.insert(replacement, {
    insertionMode: 'replaceSelection',
    selectionMode: 'after',
    format: 'latex',
    silenceNotifications: replacement === contents,
  });
  field.selection = selection;
}

export function insertMathStructureRow(
  field: StructureField,
  structure: ExpertMathStructure | null,
) {
  if (!structure) return false;
  const row = selectedRow(field, structure);
  if (!row) return false;

  field.position = row.range[1];
  field.insert(EXPERT_MATH_STRUCTURE.rowBreak);
  return true;
}

export function deleteEmptyMathStructure(
  field: StructureField,
  structure: ExpertMathStructure | null,
) {
  if (!structure) return false;

  if (field.selection.ranges[0][0] >= structure.arrayRange[1]) {
    if (!structure.empty) return false;
    deleteRange(field, structure.range, structure.rows?.at(-1));
    return true;
  }

  const row = selectedRow(field, structure);
  if (!row?.empty) return false;
  if (structure.rows?.length === 1) {
    deleteRange(field, structure.range, row);
    return true;
  }

  // Последний нативный Backspace мог оставить в истории состояние ещё с символом.
  // Сохраняем именно пустую строку до отдельной операции её удаления.
  recordRangeState(field, row.range, true);
  field.position = row.range[0];
  const before = field.value;
  field.executeCommand(EXPERT_MATH_STRUCTURE.commands.remove);
  if (field.value === before) return true;

  const updated = readStructures(field).find(
    ({ arrayRange }) => arrayRange[0] === structure.arrayRange[0],
  );
  const remainingRow = updated && selectedRow(field, updated);
  if (remainingRow) recordRangeState(field, remainingRow.range, true);
  return true;
}

export function deleteEmptyMathDelimiter(field: StructureField) {
  if (field.selection.ranges.length !== 1) return false;

  const nodes = readNodes(field);
  const emptyOffsets = new Set<number>();
  const ranges: Range[] = [];
  for (const node of nodes) {
    const delimiter = EXPERT_MATH_STRUCTURE.delimiterPairs.some(
      ({ left, right }) => node.latex.startsWith(left) && node.latex.endsWith(right),
    );
    if (!delimiter) continue;

    const range = nodeRange(nodes, node);
    const empty = nodes
      .slice(range[0] + 1, range[1])
      .every(
        (child) =>
          !child.latex ||
          child.latex.startsWith(EXPERT_MATH_STRUCTURE.placeholderPrefix) ||
          emptyOffsets.has(child.offset),
      );
    if (empty) {
      emptyOffsets.add(node.offset);
      ranges.push(range);
    }
  }

  const [start, end] = field.selection.ranges[0];
  const enclosing = ranges.find((range) => start > range[0] && end <= range[1]);
  if (!enclosing) return false;

  const innermost = ranges.find((range) => range[0] >= enclosing[0] && range[1] <= enclosing[1]);
  if (!innermost) return false;

  deleteRange(field, innermost);
  return true;
}
