'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import type { ExpertTask } from '@/config/expert';
import { EXPERT_TASK_NAVIGATION } from '@/config/expert-task-navigation';
import { expertTaskNavigationItems } from '@/lib/expert-task-navigation';

export function useExpertTaskTabs(
  tasks: ExpertTask[],
  currentTaskId: string,
  onSelect: (id: string) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const items = expertTaskNavigationItems(tasks);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === currentTaskId),
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const pills = pillsRef.current;
    if (!container || !pills) return;

    const measure = () => {
      setCompact(pills.scrollWidth > container.clientWidth + EXPERT_TASK_NAVIGATION.fitTolerance);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(pills);
    measure();

    return () => observer.disconnect();
  }, []);

  return {
    containerRef,
    pillsRef,
    compact,
    items,
    index,
    current: items[index],
    taskIds: items.map((item) => item.id),
    statuses: Object.fromEntries(items.map((item) => [item.id, item.status])),
    valueLabels: items.map((item) => item.ariaLabel),
    selectIndex: (nextIndex: number) => {
      const next = items[nextIndex];
      if (next) onSelect(next.id);
    },
  };
}
