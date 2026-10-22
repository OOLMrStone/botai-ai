import { useLayoutEffect, useRef } from 'react';

import { QUIZ_FORMULA_FIT } from '@/config/quiz';

export function useQuizFormulaFit(value: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formulaRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const formula = formulaRef.current;
    if (!container || !formula) return;

    let lastWidth = 0;
    const fit = () => {
      const width = container.clientWidth;
      if (!width || width === lastWidth) return;
      lastWidth = width;
      formula.style.fontSize = '';
      const scale = Math.max(
        QUIZ_FORMULA_FIT.minScale,
        Math.min(QUIZ_FORMULA_FIT.maxScale, width / formula.scrollWidth),
      );
      formula.style.fontSize = `${scale}em`;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value]);

  return { containerRef, formulaRef };
}
