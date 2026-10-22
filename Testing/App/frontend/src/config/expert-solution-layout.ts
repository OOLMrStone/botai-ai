import { ArrowDownRight, Check, CircleAlert, CircleDashed, Lightbulb } from 'lucide-react';
import { EXPERIMENTAL_COPY } from '@/config/experimental';
import { experimentalSolutionLayout } from '@/config/experimental-solution-layout';
import { EXPERT_STATUS_OPTIONS } from '@/config/expert';

const source = experimentalSolutionLayout;
const interval = source.intervalGeometry;

export const EXPERT_SOLUTION_COPY = {
  ...EXPERIMENTAL_COPY.solution,
  empty: 'Распознанное решение пока не готово',
  emptyRejected:
    'Проверка завершена без распознанных шагов. Сверь причину отказа с оригиналом решения',
  numberLine: 'Интервальная прямая',
  unitCircle: 'Тригонометрическая окружность',
  artifactUnavailable: 'Рисунок не загрузился. Сверь его с оригиналом решения',
  diagramDescription: 'Описание рисунка',
  editBlock: (title: string) => `Исправить шаг: ${title}`,
  followsFrom: (title: string) => `Следствие ошибки в шаге: ${title}`,
  domain: (label: string, from: number | null, to: number | null) =>
    from !== null && to !== null
      ? `При ${from} < ${label} < ${to}`
      : from !== null
        ? `При ${label} > ${from}`
        : to !== null
          ? `При ${label} < ${to}`
          : '',
  ordinal: (index: number) => String(index + 1).padStart(2, '0'),
} as const;

export const EXPERT_SOLUTION_STATUSES = {
  pending: { icon: CircleDashed },
  correct: { icon: Check },
  error: { icon: CircleAlert },
  warning: { icon: Lightbulb },
  follow_through: { icon: ArrowDownRight },
} as const;

export const expertSolutionLayout = {
  ...source,
  root: `${source.root} isolate`,
  header: 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pt-4 pb-1 sm:px-7',
  body: `${source.body} relative isolate`,
  block: 'group/block relative',
  blockTrigger: 'pr-13 sm:pr-14',
  editAction: 'absolute top-1.5 right-0 z-20 text-muted-foreground sm:right-1',
  blockText: 'block whitespace-pre-line text-base leading-relaxed',
  stepContent: 'flex min-w-0 flex-col gap-3',
  description: 'min-w-0',
  descriptionSummary:
    'cursor-pointer py-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
  descriptionBody: 'flex min-w-0 flex-col gap-3 pb-3',
  blockDescription: 'pr-13 pl-11 sm:pr-14 sm:pl-13',
  artifactFrame: 'block max-w-full overflow-x-auto overscroll-x-contain',
  artifactImage: 'block h-auto max-h-[32rem] w-auto max-w-full rounded-tile object-contain',
  artifactUnavailable:
    'flex items-center gap-3 py-4 text-sm text-muted-foreground [&_svg]:size-5 [&_svg]:shrink-0',
  artifactFallback: { width: 1200, height: 800 },
  relatedAction: 'justify-start text-left text-sky-700 dark:text-sky-400',
  empty: 'px-5 py-8 text-sm text-muted-foreground',
  diagramViewport: 'block max-w-full overflow-x-auto overscroll-x-contain py-1',
  numberLineSvg: 'block w-full min-w-[30rem] text-foreground',
  tones: {
    pending: {
      text: 'text-muted-foreground',
      background: 'bg-muted/45',
      marker: 'bg-muted-foreground/40',
    },
    correct: source.tones.correct,
    error: source.tones.error,
    warning: source.tones.note,
    follow_through: source.tones.inherited,
  },
  statusLabels: Object.fromEntries(
    EXPERT_STATUS_OPTIONS.map((option) => [option.value ?? 'pending', option.label]),
  ),
  numberLine: {
    ...interval,
    curveAmplitude: 62,
    curveHandleRatio: 0.15,
    rayHeight: 40,
    rayHandleRatio: 0.65,
    positiveSignY: 56,
    negativeSignY: 98,
    pointSignY: 50,
    labelBox: { width: 100, height: 38, y: 114 },
  },
  circle: 'mx-auto block w-full max-w-80 overflow-visible text-foreground',
  circleNeutralPoint: 'fill-muted-foreground stroke-background',
  circleSelectedArc: 'fill-none stroke-success',
  circleFormula: 'text-center text-sm',
  circleGeometry: {
    viewBox: '0 0 320 300',
    center: { x: 160, y: 150 },
    radius: 105,
    labelRadius: 128,
    labelBox: { width: 62, height: 36 },
    axisStart: 24,
    axisEnd: 296,
    verticalStart: 16,
    verticalEnd: 284,
    axisLabels: { x: { x: 305, y: 154 }, y: { x: 170, y: 16 } },
    axes: { x: 'x', y: 'y' },
    strokeWidth: interval.axis.strokeWidth,
    selectedStrokeWidth: interval.solution.strokeWidth,
    pointRadius: interval.point.r,
    pointStrokeWidth: interval.point.strokeWidth,
    haloRadius: interval.halo.r,
    fullTurn: Math.PI * 2,
    halfTurn: Math.PI,
  },
} as const;
