export const EXPERT_CAUSE_PICKER_COPY = {
  title: 'Где появилась ошибка',
  hint: 'Нажми на ошибочный шаг, который привёл к этому результату',
  selected: 'Причина выбрана',
  select: 'Выбрать этот шаг',
  empty: 'Выше пока нет шагов с ошибкой',
  emptyHint: 'Если ошибка появилась на текущем шаге, отметь её здесь',
  markError: 'Ошибка появилась здесь',
  required: 'Выбери хотя бы один шаг с ошибкой',
} as const;

export const expertCausePickerLayout = {
  root: 'flex min-w-0 flex-col gap-3',
  hint: 'text-sm leading-relaxed text-muted-foreground',
  list: 'flex min-w-0 flex-col gap-3',
  option:
    'group/cause flex min-h-11 w-full min-w-0 flex-col gap-3 rounded-card border border-border bg-background p-4 text-left outline-none transition-opacity duration-[var(--task-control-motion-duration)] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring active:opacity-80 motion-reduce:transition-none',
  selected: 'border-foreground/50 bg-muted/55',
  header: 'flex min-w-0 items-center justify-between gap-3',
  title: 'min-w-0 text-sm font-medium',
  selection:
    'flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground',
  selectionActive: 'border-foreground bg-foreground text-background',
  selectionIcon: 'size-3.5',
  content: 'block w-full min-w-0 [&_svg]:max-h-44',
  feedback: 'text-sm text-muted-foreground',
  empty: 'flex flex-col items-start gap-3 rounded-card bg-muted/50 p-4',
  emptyText: 'space-y-1',
  emptyTitle: 'text-sm font-medium',
} as const;
