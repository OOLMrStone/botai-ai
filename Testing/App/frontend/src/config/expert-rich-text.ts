import { expertLayout } from '@/config/expert-layout';

export interface GridRichTextSegment {
  kind: 'text' | 'math';
  value: string;
  opening: string;
  closing: string;
  displayMode: boolean;
}

const inlineDelimiter = { opening: '\\(', closing: '\\)', displayMode: false } as const;
const displayDelimiter = { opening: '\\[', closing: '\\]', displayMode: true } as const;

export const EXPERT_RICH_TEXT = {
  diagramDescriptionStart: /(?:^|\n)[ \t]*\[(?:числовая|интервальная)\s+прямая\s*:/gi,
  delimiters: [
    { opening: '$$', closing: '$$', displayMode: true },
    displayDelimiter,
    inlineDelimiter,
    { opening: '$', closing: '$', displayMode: false },
  ],
  bareStartPattern:
    /^\\(?:d?frac|tfrac|sqrt|begin|left|text|mathrm|mathbf|mathbb|log|ln|sin|cos|tan|cot|tg|ctg|lim|sum|prod|int|pi|alpha|beta|gamma|theta|omega|varphi|phi|Delta|infty)\b/,
  environmentPattern:
    /\\(?:begin|end)\{(?:cases|aligned|align\*?|gathered|matrix|pmatrix|bmatrix)\}/g,
  commandPattern: /\\(?:[a-zA-Z]+|[\\{}()[\]|,;! ])/g,
  textCommandPattern: /\\(?:text|textrm|textbf|textit|operatorname)\s*\{/g,
  bareCharactersPattern: /^[\dA-Za-z\s{}[\]()_^+\-*/=<>.,;:|!&%~'"π∞≤≥≠×·−±∈∪∩∅→⇒]+$/,
  proseWordPattern: /[A-Za-z]{2,}/,
  statementMathPattern: /[=<>^_≤≥≠×·−±∈∪∩∅→⇒]|\\[a-zA-Z]+/,
  displayDelimiter,
  newMath: { kind: 'math', value: '', ...inlineDelimiter },
  newText: { kind: 'text', value: '', opening: '', closing: '', displayMode: false },
} as const;

export const EXPERT_RICH_TEXT_COPY = {
  addText: 'Добавить текст',
  addMath: 'Добавить формулу',
  remove: 'Удалить фрагмент',
  textLabel: (label: string, index: number) => `${label} · текст ${index + 1}`,
  mathLabel: (label: string, index: number) => `${label} · формула ${index + 1}`,
} as const;

export const expertRichTextLayout = {
  root: 'whitespace-pre-wrap break-words',
  inlineMath: 'inline-block max-w-full overflow-x-auto align-middle',
  displayMath: 'block max-w-full overflow-x-auto py-2',
  editor: expertLayout.editorSection,
  segment: expertLayout.editorRow,
  segmentBody: expertLayout.editorField,
  textLabel: expertLayout.inputLabel,
  textarea: expertLayout.textarea,
  actions: expertLayout.compactActions,
} as const;
