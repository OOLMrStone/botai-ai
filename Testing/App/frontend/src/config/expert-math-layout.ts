export const expertMathLayout = {
  root: 'flex min-w-0 flex-col gap-2',
  label: 'sr-only',
  host: 'min-w-0',
  field:
    'block min-h-16 w-full max-w-full overflow-x-auto rounded-card border border-border bg-background p-3 text-lg text-foreground outline-none [--caret-color:var(--foreground)] [--selection-background-color:var(--brand-soft)] [--selection-color:var(--foreground)] [--contains-highlight-background-color:var(--muted)] [--placeholder-color:var(--muted-foreground)] [--text-font-family:var(--font-product)] focus-within:ring-2 focus-within:ring-ring/30 [&::part(menu-toggle)]:hidden [&::part(virtual-keyboard-toggle)]:hidden',
  tools: 'flex min-w-0 items-center gap-1 rounded-control bg-muted/45 p-1',
  presets: 'relative min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]',
  presetItems: 'flex w-max items-center gap-1',
  presetsFadeStart: '[mask-image:linear-gradient(to_right,transparent,black_1rem)]',
  presetsFadeEnd: '[mask-image:linear-gradient(to_left,transparent,black_1rem)]',
  presetsFadeBoth:
    '[mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%_-_1rem),transparent)]',
  symbol: 'text-foreground',
  symbolsToggle: 'shrink-0 bg-background/70 text-muted-foreground',
  icon: 'size-4 shrink-0',
  palette: 'flex min-w-0 flex-col gap-3 rounded-panel bg-muted/45 p-2',
  groups: 'grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-1',
  groupTab: 'min-w-0 px-3 text-center',
  search: 'relative min-w-0',
  searchIcon:
    'pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground',
  searchInput: 'bg-background pr-14 pl-10 [&::-webkit-search-cancel-button]:hidden',
  searchClear: 'absolute inset-y-0 right-0.5 my-auto text-muted-foreground',
  results: 'flex min-w-0 flex-col gap-3',
  resultGroup: 'flex min-w-0 flex-col gap-1',
  resultLabel: 'px-2 text-xs text-muted-foreground',
  empty: 'px-2 py-3 text-sm text-muted-foreground',
  symbols: 'flex flex-wrap items-center gap-1',
  pending:
    'flex min-h-16 items-center gap-3 rounded-tile bg-muted/40 px-4 text-sm text-muted-foreground',
  error: 'flex flex-wrap items-center gap-3 text-sm text-destructive',
  invalid: 'text-xs text-destructive',
} as const;
