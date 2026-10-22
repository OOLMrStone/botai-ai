import { EXPERT_RICH_TEXT, type GridRichTextSegment } from '@/config/expert-rich-text';

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 !== 0;
}

function findClosing(source: string, start: number, closing: string) {
  let index = source.indexOf(closing, start);
  while (index !== -1) {
    const sharedDollar =
      closing === '$' && (source[index - 1] === '$' || source[index + 1] === '$');
    if (!isEscaped(source, index) && !sharedDollar) return index;
    index = source.indexOf(closing, index + closing.length);
  }
  return -1;
}

function balancedBraces(value: string) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function stripTextCommands(value: string) {
  const pattern = new RegExp(EXPERT_RICH_TEXT.textCommandPattern);
  let result = '';
  let cursor = 0;
  let match = pattern.exec(value);

  while (match) {
    result += value.slice(cursor, match.index);
    let depth = 1;
    let end = pattern.lastIndex;
    while (end < value.length && depth > 0) {
      if (!isEscaped(value, end)) {
        if (value[end] === '{') depth += 1;
        if (value[end] === '}') depth -= 1;
      }
      end += 1;
    }
    cursor = end;
    pattern.lastIndex = end;
    match = pattern.exec(value);
  }

  return result + value.slice(cursor);
}

function isBareMathLine(value: string) {
  const hasNotation =
    EXPERT_RICH_TEXT.bareStartPattern.test(value) ||
    (!value.startsWith('\\') && EXPERT_RICH_TEXT.statementMathPattern.test(value));
  if (!hasNotation || !balancedBraces(value)) return false;

  const expression = stripTextCommands(value)
    .replace(EXPERT_RICH_TEXT.environmentPattern, '')
    .replace(EXPERT_RICH_TEXT.commandPattern, '');

  return (
    expression.trim() === '' ||
    (EXPERT_RICH_TEXT.bareCharactersPattern.test(expression) &&
      !EXPERT_RICH_TEXT.proseWordPattern.test(expression))
  );
}

export function isGridMathStatement(value: string) {
  if (
    tokenizeGridRichText(value).some((segment) => segment.kind === 'math' && segment.opening !== '')
  )
    return false;
  if (!EXPERT_RICH_TEXT.statementMathPattern.test(value) || !balancedBraces(value)) return false;

  const expression = stripTextCommands(value)
    .replace(EXPERT_RICH_TEXT.environmentPattern, '')
    .replace(EXPERT_RICH_TEXT.commandPattern, '');

  return (
    EXPERT_RICH_TEXT.bareCharactersPattern.test(expression) &&
    !EXPERT_RICH_TEXT.proseWordPattern.test(expression)
  );
}

function textSegment(value: string): GridRichTextSegment {
  return { ...EXPERT_RICH_TEXT.newText, value };
}

export function tokenizeGridRichText(source: string): GridRichTextSegment[] {
  const segments: GridRichTextSegment[] = [];
  let textStart = 0;
  let cursor = 0;
  const appendMath = (start: number, end: number, segment: GridRichTextSegment) => {
    if (start > textStart) segments.push(textSegment(source.slice(textStart, start)));
    segments.push(segment);
    cursor = end;
    textStart = end;
  };

  while (cursor < source.length) {
    const delimiter = EXPERT_RICH_TEXT.delimiters.find((candidate) =>
      source.startsWith(candidate.opening, cursor),
    );
    if (delimiter && !isEscaped(source, cursor)) {
      const contentStart = cursor + delimiter.opening.length;
      const closing = findClosing(source, contentStart, delimiter.closing);
      if (closing !== -1) {
        appendMath(cursor, closing + delimiter.closing.length, {
          kind: 'math',
          value: source.slice(contentStart, closing),
          ...delimiter,
        });
        continue;
      }
      cursor += delimiter.opening.length;
      continue;
    }

    if (cursor === 0 || source[cursor - 1] === '\n') {
      const lineEnd = source.indexOf('\n', cursor);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(cursor, end);
      const expression = line.trim();
      if (isBareMathLine(expression)) {
        const start = cursor + line.indexOf(expression);
        appendMath(start, start + expression.length, {
          kind: 'math',
          value: expression,
          opening: '',
          closing: '',
          displayMode: true,
        });
        continue;
      }
    }

    cursor += 1;
  }

  if (textStart < source.length) segments.push(textSegment(source.slice(textStart)));
  return segments.length ? segments : [textSegment(source)];
}

export function serializeGridRichText(segments: GridRichTextSegment[]) {
  return segments
    .map((segment) =>
      segment.kind === 'math' ? segment.opening + segment.value + segment.closing : segment.value,
    )
    .join('');
}

export function editGridRichTextSegment<T extends GridRichTextSegment>(
  segment: T,
  value: string,
): T {
  const needsDelimiter =
    segment.kind === 'math' && segment.opening === '' && !isBareMathLine(value);

  return { ...segment, value, ...(needsDelimiter ? EXPERT_RICH_TEXT.displayDelimiter : {}) };
}

export function encloseGridRichTextTail<T extends GridRichTextSegment>(segments: T[]): T[] {
  return segments.map((segment, index) =>
    index === segments.length - 1 && segment.kind === 'math' && segment.opening === ''
      ? { ...segment, ...EXPERT_RICH_TEXT.displayDelimiter }
      : segment,
  );
}
