'use client';

import { useEffect, useRef, useState } from 'react';
import { HOME_ATTEMPT_MEASUREMENT_RESERVE } from '@/config/attempts';
import { countFittingAttempts } from '@/lib/attempt-list';

export function useHomeAttemptCapacity(enabled: boolean, cardIds: string[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const cardCount = cardIds.length;
  const capacity = enabled ? Math.min(visibleCount, cardCount) : cardCount;
  const renderCount = enabled
    ? Math.min(cardCount, capacity + HOME_ATTEMPT_MEASUREMENT_RESERVE)
    : cardCount;
  const cardKey = cardIds.slice(0, renderCount).join('|');

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list || !cardCount) return;
    const rows = Array.from(list.children);
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
      const count = countFittingAttempts(
        list.getBoundingClientRect().height,
        rows.map((row) => row.getBoundingClientRect().height),
        gap,
      );
      setVisibleCount((previous) => (previous === count ? previous : count));
    };
    // Одна запасная строка даёт точную высоту следующей карточки без рендера всей истории.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [enabled, cardCount, cardKey, renderCount]);

  return { listRef, visibleCount: capacity, renderCount };
}
