// Вход используется только в последовательных сценариях. Вкладки открываются без анимации.
export const MOTION_STYLES = {
  flowEnter:
    'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 motion-safe:ease-out',
  progressEnter:
    'motion-safe:animate-[flow-progress-enter_var(--progress-motion-duration)_ease-out]',
  loadingSpin: 'motion-safe:animate-spin',
  loadingPulse: 'motion-safe:animate-pulse',
} as const;

export const sheetMotion = {
  dismissMs: 220,
  snapBackMs: 260,
  releaseEasing: 'cubic-bezier(0.22, 0.8, 0.25, 1)',
} as const;

export const sheetGestures = {
  dragSlopPx: 6,
  dismissDistanceRatio: 0.24,
  dismissVelocityPxMs: 0.65,
} as const;
