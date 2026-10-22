export const billingLayout = {
  shell: 'flex h-svh flex-col overflow-y-auto overscroll-contain bg-background',
  header:
    'mx-auto flex w-full max-w-5xl shrink-0 flex-wrap items-center gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-8',
  badge:
    'ml-auto max-w-full rounded-control bg-muted px-3 py-1.5 text-center text-xs font-medium text-muted-foreground',
  content:
    'mx-auto flex w-full max-w-5xl min-h-[min(20rem,50svh)] flex-1 flex-col gap-5 overflow-y-auto overscroll-y-auto px-5 pt-4 pb-6 sm:px-8 lg:gap-7 lg:pt-8 landscape-short:min-h-0 landscape-short:flex-none landscape-short:overflow-visible [&>*]:shrink-0',
  heading: 'space-y-2 lg:text-center',
  secondary: 'text-sm leading-relaxed text-muted-foreground',
  periods: 'mx-auto w-full max-w-sm',
  offers: 'grid gap-4 lg:grid-cols-3 lg:gap-5',
  offer:
    'relative flex w-full min-w-0 flex-col rounded-card border-[1.5px] border-border bg-background px-5 py-5 text-left whitespace-normal outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4',
  collapsedOffer: 'hidden lg:flex',
  selected: 'border-foreground',
  offerBody: 'flex min-w-0 flex-col gap-4',
  offerHeading: 'flex min-w-0 flex-col gap-1 pr-7',
  offerTitle: 'text-lg font-semibold leading-snug',
  offerPrice: 'flex flex-col gap-1',
  price: 'text-2xl font-semibold leading-tight',
  quota: 'text-base font-medium',
  term: 'flex flex-col gap-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground',
  radio:
    'absolute top-5 right-4 flex size-6 items-center justify-center rounded-full border-[1.5px] border-border text-transparent',
  radioSelected: 'border-primary bg-primary text-primary-foreground',
  check: 'size-4',
  other:
    'mx-auto flex min-h-11 w-full max-w-sm items-center justify-center gap-1 rounded-control text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden',
  label: 'text-base font-semibold leading-snug',
  status: 'space-y-3 rounded-card border border-border bg-card p-5',
  result: 'mx-auto flex w-full max-w-lg flex-col gap-5',
  resultStatus: 'space-y-2',
  consent: 'mx-auto w-full max-w-lg space-y-4',
  consentLabel:
    'flex min-h-11 cursor-pointer items-start gap-3 rounded-tile py-2 text-sm leading-relaxed',
  consentPrompt:
    'min-h-11 w-full rounded-control text-center text-sm leading-relaxed text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
  checkbox:
    'mt-0.5 size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 disabled:cursor-default',
  subscription: 'space-y-4 border-t border-border pt-4',
  cancelSheet: '[&_h2]:min-w-0 [&_h2]:[overflow-wrap:anywhere]',
  cancelForm: 'flex flex-col gap-5',
  cancelActions: 'flex flex-col gap-3 sm:flex-row sm:justify-end',
  footer:
    'w-full shrink-0 border-t border-border bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8',
  actions: 'mx-auto flex w-full max-w-sm flex-col gap-3',
  actionNote: 'text-center text-xs leading-relaxed text-muted-foreground',
  icon: 'size-5 shrink-0',
} as const;
