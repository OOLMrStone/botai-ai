export const EXPERT_SOURCE_COPY = {
  shortTitle: 'Оригинал',
  collapse: 'Свернуть',
  fitWidth: 'По ширине панели',
  files: 'Файлы решения',
  file: (index: number, total: number) => `Файл ${index + 1} из ${total}`,
  downloadPdf: 'Скачать оригинал PDF',
  openFile: 'Открыть оригинал',
  viewControls: 'Масштаб и файлы',
} as const;

export const expertSourceLayout = {
  trigger: 'shrink-0 text-muted-foreground',
  shortLabel: 'sm:hidden',
  fullLabel: 'hidden sm:inline',
  pane: '@container/source flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border/70 bg-background',
  paneHeader:
    'flex min-w-0 shrink-0 items-center justify-between gap-1 px-2 pt-2 md:@[24rem]/source:flex-wrap md:@[24rem]/source:gap-x-3 md:@[24rem]/source:gap-y-1 md:@[24rem]/source:pt-3 md:@[24rem]/source:pb-1',
  paneShortLabel: 'md:@[24rem]/source:hidden',
  paneFullLabel: 'hidden md:@[24rem]/source:inline',
  paneHeaderActions: 'flex shrink-0 items-center gap-1',
  paneChrome: 'shrink-0',
  paneToolbar: 'hidden md:@[24rem]/source:block',
  mobileControls: 'md:@[24rem]/source:hidden',
  controlsPositioner: 'z-[70] outline-none',
  controlsPopover:
    'max-h-[min(24rem,60svh)] w-[min(22rem,calc(100svw-2rem))] overflow-y-auto overscroll-contain rounded-card border border-border/70 bg-background p-3 text-foreground shadow-lg outline-none',
  controls: { sideOffset: 8, collisionPadding: 16 },
  paneBody: 'flex min-h-0 flex-1 flex-col px-3 pb-3',
  paneViewport: 'rounded-[calc(var(--radius-panel)-0.75rem)]',
  viewportFocus:
    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
} as const;
