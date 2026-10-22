'use client';

import { useLayoutEffect, useRef, type UIEvent } from 'react';

import { useTasksStore } from '@/stores/tasks-store';

export function useTaskCatalogScroll(ready: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredScroll = useRef(false);
  const scrollTop = useTasksStore((state) => state.catalogScrollTop);
  const setScrollTop = useTasksStore((state) => state.setCatalogScrollTop);

  useLayoutEffect(() => {
    if (!ready || !scrollRef.current || restoredScroll.current) return;

    scrollRef.current.scrollTop = scrollTop;
    restoredScroll.current = true;
  }, [ready, scrollTop]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return { scrollRef, onScroll };
}
