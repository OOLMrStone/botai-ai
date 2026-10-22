'use client';

import { useEffect, useRef, useState } from 'react';

export function useHorizontalScrollEdges(tolerance: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const start = viewport.scrollLeft > tolerance;
      const end = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft > tolerance;
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', measure, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', measure);
    };
  }, [tolerance]);

  return { viewportRef, contentRef, showStartFade: edges.start, showEndFade: edges.end };
}
