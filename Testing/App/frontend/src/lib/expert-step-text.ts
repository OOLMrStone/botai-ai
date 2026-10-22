import type { ExpertDiagram } from '@/config/expert';
import { EXPERT_RICH_TEXT } from '@/config/expert-rich-text';
import { serializeGridRichText, tokenizeGridRichText } from '@/lib/grid-rich-text';

export interface ExpertStepTextPart {
  id: string;
  kind: 'text' | 'description';
  value: string;
}

export function expertStepTextParts(value: string, diagram?: ExpertDiagram): ExpertStepTextPart[] {
  if (diagram?.kind !== 'number_line_v2') return [{ id: '0', kind: 'text', value }];

  const plain = tokenizeGridRichText(value)
    .map((part) =>
      part.kind === 'text' ? part.value : serializeGridRichText([part]).replace(/[^\r\n]/g, ' '),
    )
    .join('');
  const starts = new RegExp(EXPERT_RICH_TEXT.diagramDescriptionStart);
  const parts: ExpertStepTextPart[] = [];
  const append = (kind: ExpertStepTextPart['kind'], content: string) => {
    if (content) parts.push({ id: String(parts.length), kind, value: content });
  };
  let cursor = 0;

  for (const match of plain.matchAll(starts)) {
    const start = match.index + match[0].lastIndexOf('[');
    let depth = 1;
    let end = start + 1;
    while (end < plain.length && plain[end] !== '\n' && depth > 0) {
      if (plain[end] === '[') depth += 1;
      if (plain[end] === ']') depth -= 1;
      end += 1;
    }
    if (depth !== 0) continue;

    append('text', value.slice(cursor, start));
    append('description', value.slice(start, end));
    cursor = end;
  }
  append('text', value.slice(cursor));

  return parts.length ? parts : [{ id: '0', kind: 'text', value }];
}

export function replaceExpertStepTextPart(parts: ExpertStepTextPart[], id: string, value: string) {
  return parts.map((part) => (part.id === id ? { ...part, value } : part));
}
