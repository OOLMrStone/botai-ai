import { experimentalLayout } from '@/config/experimental-layout';

export const expertLayout = {
  ...experimentalLayout,
  reviewHeader:
    'contents lg:grid lg:shrink-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center lg:gap-8 lg:px-8 lg:py-3',
  reviewIdentity: 'flex min-w-0 shrink-0 items-center gap-4 px-4 pt-4 pb-2 sm:px-8 lg:p-0',
  reviewTaskBar:
    'sticky top-0 z-30 flex min-w-0 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background px-4 py-3 sm:px-8 lg:static lg:border-0 lg:p-0',
  reviewTaskNumber: 'hidden shrink-0 whitespace-nowrap text-lg font-medium tabular-nums lg:block',
  rootCompare: 'h-svh overflow-hidden',
  reviewCompare: 'min-h-0 overflow-hidden',
  reviewPanes: 'flex min-h-0 flex-1 flex-col',
  reviewPanesCompare:
    'grid grid-rows-[minmax(0,0.4fr)_minmax(0,0.6fr)] border-t border-border/70 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:grid-rows-1',
  sourcePane:
    'min-h-0 min-w-0 overflow-hidden border-b border-border/70 bg-muted/20 px-4 py-3 md:border-r md:border-b-0 md:py-5 sm:px-5',
  columnsCompare: 'flex flex-col overflow-y-auto overscroll-contain border-t-0',
  documentCompare: 'shrink-0 overflow-visible border-r-0 lg:overflow-visible',
  asideCompare: 'shrink-0',
  verdictBodyCompare: 'flex-none overflow-visible lg:overflow-visible',
  checkedApproval: 'disabled:opacity-100',
  queueHeading: 'min-w-0 flex-1',
  queueStatusTones: {
    ready: 'bg-success',
    reviewed: 'bg-muted-foreground',
    pending: 'bg-muted-foreground',
    warning: 'bg-brand',
  },
  avatar:
    'hidden size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold sm:flex',
  account: 'flex items-center gap-1 sm:gap-3',
  sourceDesktop: 'hidden sm:block',
  sourceMobile: 'sm:hidden',
  topbar:
    'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-8',
  topbarCompare: 'hidden md:flex',
  navigation: 'flex items-center gap-1',
  navButton: 'text-sm text-muted-foreground',
  navActive: 'bg-muted/60 text-foreground',
  login: 'mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-5 py-10',
  loginForm: 'flex flex-col gap-4',
  loginDivider: 'h-px bg-border/70',
  notice:
    'flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3 text-sm sm:px-8',
  noticeError: 'bg-destructive/5 text-destructive',
  feedback:
    'fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 max-w-[calc(100%-2rem)] rounded-tile border border-border bg-background px-4 py-3 text-sm shadow-lg',
  tabs: 'flex flex-wrap items-center gap-1',
  filter:
    'flex min-h-11 items-center gap-2 rounded-control px-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
  filterActive: 'bg-muted/50 text-foreground',
  studentCards: 'grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3',
  studentCard: 'flex min-w-0 flex-col gap-5 rounded-card border border-border/70 p-5',
  contact: 'break-all text-sm text-muted-foreground',
  contactLabel: 'text-xs text-muted-foreground',
  contacts: 'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2',
  compactActions: 'flex flex-wrap items-center gap-2',
  unsaved: 'text-xs text-brand-strong',
  editor: 'max-h-[calc(100svh-1rem)] overflow-y-auto desktop:max-w-3xl',
  wideEditor: 'max-h-[calc(100svh-1rem)] overflow-y-auto desktop:max-w-4xl',
  compareEditor: 'lg:max-w-6xl',
  editorBody: 'mt-8 flex min-w-0 flex-col gap-5',
  editorWorkspace: 'flex min-w-0 flex-col gap-5',
  editorWorkspaceCompare:
    'lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:items-start lg:gap-7',
  editorForm: 'flex min-w-0 flex-col gap-5',
  editorSection: 'flex min-w-0 flex-col gap-3',
  editorRow: 'flex min-w-0 items-start gap-2',
  editorField: 'min-w-0 flex-1',
  editorGrid: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2',
  geometryRow: 'grid min-w-0 grid-cols-2 items-end gap-3 sm:grid-cols-4',
  geometryCard: 'flex min-w-0 flex-col gap-3 rounded-tile border border-border/70 p-4',
  geometryPointSettings:
    'flex flex-wrap items-end gap-x-4 gap-y-2 [&>label:first-child]:min-w-0 [&>label:first-child]:flex-1 [&>button]:ml-auto',
  geometryPointFooter: 'flex items-center justify-between gap-3',
  editorFooter:
    'sticky bottom-0 z-30 -mx-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-stretch gap-3 border-t border-border bg-background px-1 pt-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_2rem_0_var(--background)] sm:flex sm:justify-end',
  preview: 'overflow-x-auto rounded-tile border border-border/70 bg-muted/20 p-4',
  geometryPreview:
    "sticky top-0 z-20 isolate pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:bottom-[var(--radius-tile)] before:-z-10 before:bg-background before:content-['']",
  geometryClip: 'overflow-clip',
  geometryPreviewContent:
    'rounded-tile border border-border/70 bg-background p-3 [&_svg]:max-h-44 [&_svg]:min-w-0',
  editorHeading: 'text-sm font-medium text-foreground',
  findingContainer: 'relative',
  findingEdit: 'absolute top-1 right-1 text-muted-foreground',
  findingContent: 'pr-8',
  findingEmpty: 'flex items-center justify-between gap-3 text-sm text-muted-foreground',
  reviewAnchor: 'scroll-mt-20',
  checkLabel: 'flex min-h-11 cursor-pointer items-center gap-3 text-sm',
  checkboxControl: 'relative flex size-6 shrink-0 items-center justify-center',
  checkbox:
    'peer size-6 cursor-pointer appearance-none rounded-control border border-border bg-background outline-none checked:border-foreground checked:bg-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  checkboxIcon:
    'pointer-events-none absolute size-3.5 text-background opacity-0 peer-checked:opacity-100',
  selectRoot: 'relative block min-w-0',
  select: 'w-full appearance-none border border-border bg-background pl-4 pr-11 text-base',
  selectIcon:
    'pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
  smallTextarea: 'min-h-24',
  stickyApproval:
    'sticky bottom-0 z-10 flex shrink-0 flex-col gap-2 border-t border-border/70 bg-background pt-4 pb-[max(0.25rem,env(safe-area-inset-bottom))]',
  loading: 'flex flex-1 items-center justify-center px-5 py-16 text-sm text-muted-foreground',
  sourceMissing:
    'flex min-h-48 items-center justify-center rounded-tile bg-muted/20 p-5 text-center text-sm text-muted-foreground',
  photoViewer: 'flex min-h-0 min-w-0 flex-1 flex-col gap-2',
  photoViewerCompare:
    'sticky top-0 z-10 h-[clamp(12rem,32svh,20rem)] shrink-0 flex-none bg-background pb-2 lg:h-[clamp(20rem,calc(100svh-12rem),42rem)]',
  photoViewerToolbar: 'flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1',
  photoViewerPages: 'flex min-w-0 flex-wrap items-center gap-1',
  photoViewerPage: 'text-muted-foreground',
  photoViewerActions: 'ml-auto flex shrink-0 items-center',
  photoViewerScale: 'tabular-nums text-xs text-muted-foreground',
  photoViewerViewport:
    'relative min-h-0 w-full flex-1 overflow-auto overscroll-contain rounded-tile bg-muted/20',
  photoViewerCanvas: 'relative',
  photoViewerPannable: 'cursor-grab active:cursor-grabbing',
  photoViewerError:
    'flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground',
} as const;
