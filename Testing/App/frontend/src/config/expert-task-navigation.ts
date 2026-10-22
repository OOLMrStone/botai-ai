export const EXPERT_TASK_NAVIGATION = {
  fitTolerance: 1,
  label: 'Навигация по задачам',
  pending: 'Ждёт проверки',
  position: (label: string, total: number) => `${label} из ${total}`,
  score: (score: number, maxScore: number) => `${score}/${maxScore}`,
  scoreDescription: (score: number, maxScore: number) => `${score} из ${maxScore} баллов`,
  description: (position: string, status: string, score?: string) =>
    [position, status, score].filter(Boolean).join(', '),
} as const;

export const expertTaskNavigationLayout = {
  back: 'self-start lg:self-center',
  avatar: 'hidden sm:flex',
  root: 'relative min-w-0 flex-1 lg:max-w-2xl',
  pillsViewport: 'flex min-w-0 lg:justify-end',
  measuringViewport: 'pointer-events-none invisible absolute inset-x-0 top-0 overflow-hidden',
  pills: 'flex w-max min-w-full items-center gap-1 rounded-control bg-muted/55 p-1 lg:min-w-0',
  pill: 'flex-1 shrink-0 whitespace-nowrap border border-transparent lg:flex-none',
  pillActive: 'border-border bg-background font-medium text-foreground shadow-sm',
  pillScore: 'text-xs tabular-nums',
  tones: {
    unverified: '',
    correct: 'text-success hover:text-success',
    incorrect: 'text-destructive hover:text-destructive',
    partial: 'text-brand-strong hover:text-brand-strong',
  },
  scrubber: 'h-11 min-w-0',
  scrubberStatusStyles: {
    partial: {
      segment: 'border-brand bg-brand',
      lens: 'data-[status=partial]:border-brand',
    },
  },
} as const;
