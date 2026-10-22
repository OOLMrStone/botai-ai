'use client';

import { useEffect } from 'react';

import { EXPERIMENTAL, EXPERIMENTAL_POINTS } from '@/config/experimental';
import { QUIZ_MOTION } from '@/config/quiz-motion';
import { centeredExperimentalScrollTop } from '@/lib/experimental-reveal';
import { useExperimentalStore } from '@/stores/experimental-store';

export function useExperimentalPointReveal() {
  const revealPointId = useExperimentalStore((state) => state.revealPointId);
  const revealRevision = useExperimentalStore((state) => state.revealRevision);
  const finishPointReveal = useExperimentalStore((state) => state.finishPointReveal);
  const cancelPointReveal = useExperimentalStore((state) => state.cancelPointReveal);

  useEffect(() => () => cancelPointReveal(), [cancelPointReveal]);

  useEffect(() => {
    if (!revealPointId) return;

    const target = document.getElementById(EXPERIMENTAL_POINTS[revealPointId].elementId);
    const container = target?.closest<HTMLElement>(EXPERIMENTAL.documentSelector);
    if (!target || !container) {
      cancelPointReveal(revealRevision);
      return;
    }

    const header = container.querySelector<HTMLElement>(EXPERIMENTAL.solutionHeaderSelector);
    const localScroll = ['auto', 'scroll'].includes(window.getComputedStyle(container).overflowY);
    const scrollHost = localScroll ? container : window;
    const scrollEvents = localScroll ? container : document;

    const visibleBounds = () => {
      const bounds = container.getBoundingClientRect();
      const headerHeight = header?.getBoundingClientRect().height ?? 0;

      return {
        top:
          (localScroll ? Math.max(0, bounds.top) : 0) + headerHeight + EXPERIMENTAL.revealInsetPx,
        bottom:
          (localScroll ? Math.min(window.innerHeight, bounds.bottom) : window.innerHeight) -
          EXPERIMENTAL.revealInsetPx,
      };
    };

    const bounds = visibleBounds();
    const rect = target.getBoundingClientRect();
    const scrollElement = localScroll
      ? container
      : (document.scrollingElement ?? document.documentElement);
    const scrollTop = localScroll ? container.scrollTop : window.scrollY;
    const nextScrollTop = centeredExperimentalScrollTop({
      target: rect,
      viewport: bounds,
      scrollTop,
      maxScrollTop: scrollElement.scrollHeight - scrollElement.clientHeight,
    });
    const offset = nextScrollTop - scrollTop;

    if (Math.abs(offset) <= EXPERIMENTAL.revealTolerancePx) {
      finishPointReveal(revealPointId, revealRevision);
      return;
    }

    const reducedMotion = window.matchMedia(QUIZ_MOTION.reducedMotionQuery).matches;
    let finished = false;

    const cleanup = () => {
      finished = true;
      window.clearTimeout(timeout);
      scrollEvents.removeEventListener('scrollend', finish);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('wheel', cancel, true);
      window.removeEventListener('touchstart', cancel, true);
      window.removeEventListener('keydown', cancelOnEscape);
      scrollHost.scrollBy({ top: 0, behavior: 'instant' });
    };

    const cancel = () => {
      if (finished) return;

      finished = true;
      cleanup();
      cancelPointReveal(revealRevision);
    };

    const finish = () => {
      if (finished) return;

      const currentBounds = visibleBounds();
      const currentRect = target.getBoundingClientRect();
      const visible =
        target.isConnected &&
        currentRect.bottom > currentBounds.top &&
        currentRect.top < currentBounds.bottom;

      finished = true;
      cleanup();
      if (visible) finishPointReveal(revealPointId, revealRevision);
      else cancelPointReveal(revealRevision);
    };

    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };

    scrollEvents.addEventListener('scrollend', finish);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('wheel', cancel, { capture: true, passive: true });
    window.addEventListener('touchstart', cancel, { capture: true, passive: true });
    window.addEventListener('keydown', cancelOnEscape);

    // В старых браузерах scrollend нет: ожидание ограничено, карточка не остаётся подвешенной.
    const timeout = window.setTimeout(finish, EXPERIMENTAL.revealTimeoutMs);
    scrollHost.scrollBy({ top: offset, behavior: reducedMotion ? 'instant' : 'smooth' });
    if (reducedMotion) finish();

    return cleanup;
  }, [revealPointId, revealRevision, finishPointReveal, cancelPointReveal]);
}
