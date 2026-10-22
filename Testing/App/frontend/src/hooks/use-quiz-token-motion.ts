'use client';

import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

import { QUIZ_MOTION } from '@/config/quiz-motion';

function tokenElements(container: HTMLDivElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-quiz-token]'));
}

export function useQuizTokenMotion() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationsRef = useRef<Animation[]>([]);

  useEffect(() => () => animationsRef.current.forEach((animation) => animation.cancel()), []);

  const moveToken = useCallback((update: () => void) => {
    const container = containerRef.current;
    if (!container) return update();

    const reducedMotion = window.matchMedia(QUIZ_MOTION.reducedMotionQuery).matches;
    const focused = document.activeElement;
    const focusedToken =
      focused instanceof HTMLButtonElement && container.contains(focused)
        ? focused.dataset.quizToken
        : undefined;
    // Снимаем видимое положение до отмены: быстрый повторный тап не обрывает траекторию.
    const before = new Map(
      tokenElements(container).map((element) => [
        element.dataset.quizToken,
        element.getBoundingClientRect(),
      ]),
    );
    animationsRef.current.forEach((animation) => animation.cancel());
    flushSync(update);

    const after = tokenElements(container).map((element) => ({
      element,
      bounds: element.getBoundingClientRect(),
    }));
    animationsRef.current = reducedMotion
      ? []
      : after.flatMap(({ element, bounds }) => {
          const previous = before.get(element.dataset.quizToken);
          if (!previous) return [];

          const x = previous.left - bounds.left;
          const y = previous.top - bounds.top;
          if (!x && !y) return [];

          return [
            element.animate(
              [{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: 'none' }],
              { duration: QUIZ_MOTION.tokenMoveMs, easing: QUIZ_MOTION.tokenMoveEasing },
            ),
          ];
        });
    if (focusedToken) {
      after
        .find(({ element }) => element.dataset.quizToken === focusedToken)
        ?.element.focus({ preventScroll: true });
    }
  }, []);

  return { containerRef, moveToken };
}
