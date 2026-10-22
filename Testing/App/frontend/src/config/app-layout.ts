// Геометрия хаба и профиля: карточки, метрики и состояния загрузки.
const homeMascotEnabled = true;

export const appLayout = {
  card: {
    surface: 'border-border bg-card min-w-0 w-full shrink-0 rounded-card border p-4',
    stack: 'flex flex-col gap-3',
    compact: 'gap-1',
    heading: 'flex flex-col gap-1',
  },
  home: {
    mascotEnabled: homeMascotEnabled,
    content:
      'mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 phone-short:gap-2 desktop:gap-6',
    header:
      'flex shrink-0 flex-col gap-4 border-b border-border pb-4 phone-short:gap-2 phone-short:pb-3 desktop:flex-row-reverse desktop:items-center desktop:justify-between desktop:gap-8 desktop:pb-6 landscape-short:flex-row-reverse landscape-short:items-center landscape-short:gap-4 landscape-short:pb-3',
    heading: 'min-w-0 flex-1',
    attemptList: 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden',
    attemptRow: 'shrink-0',
    hiddenAttempt: 'invisible pointer-events-none',
    cards:
      'flex min-h-0 flex-1 flex-col gap-3 phone-short:gap-2 desktop:grid desktop:grid-cols-[minmax(0,1fr)_20rem] desktop:gap-6 min-[1440px]:grid-cols-[minmax(0,1fr)_22rem] landscape-short:grid landscape-short:grid-cols-[minmax(0,1fr)_15rem] landscape-short:gap-4',
    aside:
      'flex shrink-0 flex-col desktop:col-start-2 desktop:row-start-1 desktop:self-start landscape-short:col-start-2 landscape-short:row-start-1 landscape-short:self-start',
    goalTitle: 'text-sm text-muted-foreground',
    goalCard: homeMascotEnabled
      ? 'relative min-h-[calc(var(--bo-size)*0.8+1.5rem)] justify-center py-3 [--bo-size:clamp(6.25rem,min(36vw,19svh),9rem)] desktop:justify-start desktop:py-4 desktop:[--bo-size:clamp(10rem,17vw,13.75rem)] min-[1440px]:[--bo-size:15rem] landscape-short:justify-start landscape-short:[--bo-size:7rem]'
      : 'justify-center py-4 desktop:py-5 landscape-short:py-3',
    goalContent: homeMascotEnabled
      ? 'relative z-10 flex max-w-[calc(100%-var(--bo-size)*0.78)] flex-col gap-3'
      : 'relative z-10 flex min-w-0 flex-col gap-3',
    goalMascot: 'absolute right-0 top-0 size-[var(--bo-size)]',
    reveal: 'min-h-11 self-start px-3 text-sm',
    question: 'text-base font-medium',
    answer: 'text-sm leading-relaxed text-muted-foreground',
    ring: 'flex items-center gap-2.5',
    ringSvg: 'size-9 shrink-0 desktop:size-10',
    ringTrack: 'stroke-border',
    ringProgress: 'stroke-brand-strong',
    ringLabel: 'flex min-w-0 flex-col gap-1',
    ringValue: 'text-3xl font-semibold leading-none tabular-nums',
    ringGoal: 'text-xs text-muted-foreground',
    ringSkeleton: 'size-9 shrink-0 rounded-full desktop:size-10',
    goalMetricSkeleton: 'h-12 w-16 rounded-tile',
    status:
      'grid min-h-6 grid-cols-[1fr_auto_1fr] items-center gap-3 font-semibold text-foreground desktop:flex desktop:shrink-0 desktop:gap-6 landscape-short:flex landscape-short:shrink-0',
    statusItem: 'flex items-center gap-1.5',
    brand: 'desktop:hidden landscape-short:hidden',
    statusEnd: 'flex items-center justify-end gap-1.5',
    statusIcon: 'size-5 shrink-0',
  },
  attempts: {
    root: '@container/attempts flex min-h-0 min-w-0 flex-1 flex-col desktop:col-start-1 desktop:row-start-1 landscape-short:col-start-1 landscape-short:row-start-1',
    toolbar: 'flex shrink-0 items-center justify-between gap-2 pb-3 phone-short:pb-1',
    filters: 'flex min-w-0 gap-1 overflow-x-auto',
    list: 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-4 [scrollbar-gutter:stable]',
    card: 'gap-3 phone-short:gap-2 phone-short:p-3 @min-[36rem]/attempts:flex-row @min-[36rem]/attempts:items-center desktop:gap-4 desktop:p-5',
    cardContent: 'min-w-0 flex-1',
    metadata: 'text-xs text-muted-foreground',
    titleRow: 'flex min-w-0 items-center gap-1',
    title: 'min-w-0 flex-1 break-words',
    rename: 'shrink-0 text-muted-foreground',
    summary: 'flex items-center gap-1.5 text-sm text-muted-foreground',
    action: 'w-full @min-[36rem]/attempts:w-auto',
    icon: 'size-4 shrink-0',
    loading: 'flex flex-col gap-3',
    skeleton: 'h-40 w-full rounded-card desktop:h-32',
    empty: 'items-start justify-center gap-5 border-dashed p-6 desktop:min-h-64 desktop:p-8',
    emptyIcon: 'size-8 text-muted-foreground',
    renameForm: 'mt-3 flex flex-col gap-4',
    renameActions: 'grid grid-cols-2 gap-3',
  },
  history: {
    content: 'mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 desktop:gap-6',
    header:
      'flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border pb-4 desktop:items-center desktop:pb-6',
    heading:
      'min-w-0 max-w-full basis-full desktop:flex-1 desktop:basis-auto landscape-short:flex-1 landscape-short:basis-auto',
  },
  profile: {
    content:
      'mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-8 pb-8 desktop:grid desktop:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] desktop:items-start desktop:gap-x-8 desktop:gap-y-6 landscape-short:grid landscape-short:grid-cols-2 landscape-short:gap-6',
    overview:
      'contents desktop:order-2 desktop:flex desktop:min-w-0 desktop:flex-col desktop:gap-6 landscape-short:order-2 landscape-short:flex landscape-short:min-w-0 landscape-short:flex-col landscape-short:gap-6',
    account:
      'contents desktop:order-3 desktop:flex desktop:min-w-0 desktop:flex-col desktop:gap-4 landscape-short:order-3 landscape-short:flex landscape-short:min-w-0 landscape-short:flex-col landscape-short:gap-4',
    card: 'p-4',
    identity:
      'order-1 flex min-w-0 flex-col items-center gap-3 py-2 text-center desktop:col-span-2 desktop:flex-row desktop:gap-5 desktop:border-b desktop:border-border desktop:pb-6 desktop:text-left landscape-short:col-span-2 landscape-short:flex-row landscape-short:gap-4 landscape-short:border-b landscape-short:border-border landscape-short:pb-4 landscape-short:text-left',
    identityText: 'flex min-w-0 w-full flex-col gap-3 desktop:flex-1 landscape-short:flex-1',
    avatar:
      'flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground',
    avatarIcon: 'size-9',
    email: 'max-w-full text-sm text-muted-foreground [overflow-wrap:anywhere]',
    joined: 'text-sm text-foreground/75',
    links: 'order-5 overflow-hidden rounded-card border border-border divide-y divide-border',
    plan: 'order-2 desktop:order-first landscape-short:order-first',
    admin: 'order-6',
    settings:
      'flex min-h-18 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-[transform,opacity] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
    linkText: 'flex min-w-0 flex-1 flex-col gap-1',
    settingsLabel: 'min-w-0 flex-1',
    settingsIcon: 'size-5 shrink-0 text-muted-foreground',
    section: 'order-3 space-y-3',
    calendarSection: 'order-4 space-y-3',
    grid: 'grid grid-cols-2 gap-3',
    metricLabel: 'flex min-w-0 items-center gap-1.5',
    metricIcon: 'size-4 shrink-0',
    metricValue: 'leading-tight [overflow-wrap:anywhere]',
    skeleton: 'h-20 rounded-card',
  },
  calendar: {
    root: 'grid grid-cols-7 gap-1',
    day: 'flex min-w-0 flex-col items-center gap-1.5',
    circle: 'flex aspect-square w-full max-w-9 items-center justify-center rounded-full text-sm',
    active: 'bg-primary/10 text-primary',
    idle: 'bg-muted text-muted-foreground',
    today: 'inset-ring-primary inset-ring-2',
    icon: 'size-4',
  },
  planGate: {
    root: 'text-muted-foreground flex items-center gap-2 text-sm',
    icon: 'size-4 shrink-0',
  },
  skeleton: {
    status: 'h-6 w-16 rounded-full',
    caption: 'h-5 w-24',
    question: 'h-12 w-full',
    action: 'h-11 w-32',
  },
} as const;

export const dailyGoalRing = {
  viewBox: '0 0 120 120',
  center: 60,
  radius: 52,
  strokeWidth: 10,
  start: 'rotate(-90 60 60)',
} as const;

export const profileSkeletonTiles = ['streak', 'study-time', 'goal', 'daily-goal'] as const;
