export const paywallLayout = {
  popup: 'fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background outline-none',
  screen:
    'mx-auto flex min-h-svh w-full max-w-md flex-col px-6 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] [@media(max-width:350px)]:px-5 lg:max-w-5xl lg:px-12 lg:py-8',
  screenExpanded: 'xl:max-w-7xl',
  bodyExpanded: 'xl:grid-cols-3 xl:grid-rows-[auto_auto_auto_1fr] xl:gap-x-6 xl:pt-6',
  headingExpanded: 'xl:col-span-3 xl:row-span-1 xl:mt-0 xl:mb-6 xl:max-w-xl',
  periodExpanded: 'xl:col-span-3 xl:col-start-1 xl:mx-auto xl:w-full xl:max-w-md',
  listExpanded: 'xl:col-span-3 xl:col-start-1 xl:grid-cols-3 xl:gap-6',
  actionsExpanded: 'xl:col-span-3 xl:col-start-1 xl:mx-auto xl:w-full xl:max-w-md xl:pt-4',
  topbar:
    'flex min-h-11 shrink-0 items-center justify-between [@media(max-height:540px)]:absolute [@media(max-height:540px)]:top-[max(0.25rem,env(safe-area-inset-top))] [@media(max-height:540px)]:right-[max(1.25rem,env(safe-area-inset-right))] lg:static',
  brand: '[@media(max-height:540px)]:hidden lg:block',
  icon: 'size-5',
  body: 'flex flex-1 flex-col lg:grid lg:grid-cols-[0.9fr_1fr] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-16 lg:pt-12',
  heading:
    'mt-2 mb-4 [@media(max-height:620px)]:mt-1 [@media(max-height:620px)]:mb-3 [@media(max-height:540px)]:mt-0 [@media(max-height:540px)]:mb-1.5 lg:col-start-1 lg:row-span-4 lg:mt-12 lg:mb-0',
  period: 'mb-[1.625rem] [@media(max-height:620px)]:mb-[1.375rem] lg:col-start-2',
  list: 'grid gap-[1.625rem] [overflow-anchor:none] lg:col-start-2',
  card: 'relative block w-full rounded-card border-[1.5px] border-border bg-background px-5 pt-7 pb-[1.125rem] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(max-width:350px)]:px-4 [@media(max-height:620px)]:pt-6 [@media(max-height:620px)]:pb-3 [@media(max-height:540px)]:pt-5 [@media(max-height:540px)]:pb-2.5',
  cardSelected: 'border-foreground',
  badge:
    'absolute top-0 left-4 -translate-y-1/2 rounded-control bg-primary px-3 py-1 text-xs font-medium text-primary-foreground',
  radio:
    'absolute top-[0.65625rem] right-[0.65625rem] flex size-6 items-center justify-center rounded-full border-[1.5px] border-border text-transparent',
  radioSelected: 'border-primary bg-primary text-primary-foreground',
  check: 'size-4',
  title:
    'mb-5 block pr-3 text-[clamp(1.25rem,5.8vw,1.5rem)] font-semibold leading-tight [@media(max-height:620px)]:mb-2',
  pricing: 'grid grid-cols-2 items-center gap-3',
  priceGroup: 'flex flex-wrap items-baseline gap-1',
  priceChange: 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200',
  price: 'text-2xl font-semibold leading-tight',
  pricePeriod: 'text-sm text-muted-foreground [@media(max-width:350px)]:text-xs',
  quota:
    'flex items-start justify-self-end gap-1 text-xs leading-snug whitespace-pre-line [@media(max-width:350px)]:text-[0.6875rem]',
  quotaIcon: 'mt-0.5 size-3 shrink-0',
  footer:
    'mt-[1.125rem] flex items-center justify-between gap-3 border-t border-border pt-3.5 [@media(max-height:620px)]:mt-2.5 [@media(max-height:620px)]:pt-2.5 [@media(max-height:540px)]:mt-2 [@media(max-height:540px)]:pt-2',
  dailyPrice:
    'flex shrink-0 flex-col items-center gap-0.5 rounded-tile bg-muted px-3 py-2 text-sm text-muted-foreground',
  dailyUnit: 'text-xs',
  charge:
    'text-sm text-muted-foreground [@media(max-width:350px)]:text-xs [@media(max-height:540px)]:text-xs',
  other:
    'mt-1.5 flex min-h-11 w-full items-center justify-center gap-1 rounded-control text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:col-start-2',
  actions: 'mt-auto lg:col-start-2 lg:pt-3',
  reserve: 'pt-[max(0.75rem,calc(24%-2.75rem))]',
  anchor: 'relative',
  mascot:
    'pointer-events-none absolute right-2 bottom-full z-10 [container-type:size] aspect-[3/2] w-[48%] translate-y-[26%]',
  cta: 'w-full',
  legal:
    'mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground [@media(max-height:620px)]:mt-2 [@media(max-height:540px)]:mt-1',
  legalLink: 'underline-offset-4 hover:underline',
  checkoutNotice: 'mt-3 text-sm leading-relaxed text-muted-foreground',
  profileButton:
    'flex w-full items-center justify-between gap-3 rounded-card border border-border bg-background p-5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
  profileText: 'flex flex-col gap-1',
} as const;
