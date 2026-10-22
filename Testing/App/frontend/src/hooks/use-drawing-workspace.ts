'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { TASK_DRAWING } from '@/config/constants';
import type { DrawingStroke } from '@/config/tasks';
import { drawingBottom } from '@/lib/task-drawing';
import { useTasksStore } from '@/stores/tasks-store';

const EMPTY_STROKES: DrawingStroke[] = [];

export function useDrawingWorkspace(taskId: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const [height, setHeight] = useState(0);
  const strokes = useTasksStore((state) => state.drawings[taskId] ?? EMPTY_STROKES);
  const strokesRef = useRef(strokes);

  const requiredHeight = useCallback(() => {
    const viewportHeight = viewportRef.current?.clientHeight ?? 0;
    const contentHeight = contentRef.current?.scrollHeight ?? 0;
    const drawingHeight = drawingBottom(strokesRef.current, viewportRef.current?.clientWidth ?? 0);

    return Math.max(
      Math.ceil(drawingHeight + TASK_DRAWING.workspaceBottomSpacePx),
      Math.min(
        TASK_DRAWING.workspaceMaxHeightPx,
        Math.ceil(
          Math.max(
            viewportHeight,
            contentHeight + TASK_DRAWING.workspaceBottomSpacePx,
            drawingHeight + TASK_DRAWING.workspaceBottomSpacePx,
          ),
        ),
      ),
    );
  }, []);

  const syncHeight = useCallback(
    (reset = false) => {
      const required = requiredHeight();
      const next = reset ? required : Math.max(heightRef.current, required);
      if (next === heightRef.current) return;
      heightRef.current = next;
      setHeight(next);
    },
    [requiredHeight],
  );

  useLayoutEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  useLayoutEffect(() => {
    heightRef.current = 0;
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    syncHeight(true);
  }, [taskId, syncHeight]);

  useLayoutEffect(() => {
    syncHeight();
  }, [strokes, syncHeight]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    if (typeof ResizeObserver === 'undefined') {
      const syncAfterResize = () => syncHeight();
      window.addEventListener('resize', syncAfterResize);
      return () => window.removeEventListener('resize', syncAfterResize);
    }

    const observer = new ResizeObserver(() => syncHeight());
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [syncHeight]);

  const ensureWritingSpace = useCallback((pointY: number) => {
    if (heightRef.current - pointY > TASK_DRAWING.workspaceGrowthThresholdPx) return;

    const next = Math.max(
      heightRef.current,
      Math.min(
        TASK_DRAWING.workspaceMaxHeightPx,
        Math.max(
          heightRef.current + TASK_DRAWING.workspaceGrowthStepPx,
          pointY + TASK_DRAWING.workspaceBottomSpacePx,
        ),
      ),
    );
    if (next === heightRef.current) return;
    heightRef.current = next;
    setHeight(next);
  }, []);

  const scrollAtWritingEdge = useCallback((clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const bottomDistance = viewport.getBoundingClientRect().bottom - clientY;
    if (bottomDistance >= TASK_DRAWING.workspaceAutoScrollEdgePx) return;
    const strength = 1 - Math.max(0, bottomDistance) / TASK_DRAWING.workspaceAutoScrollEdgePx;
    viewport.scrollTop += Math.max(1, Math.ceil(TASK_DRAWING.workspaceAutoScrollStepPx * strength));
  }, []);

  const panWorkspaceBy = useCallback((distance: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    viewport.scrollTop += distance;
  }, []);

  return {
    viewportRef,
    contentRef,
    height,
    ensureWritingSpace,
    scrollAtWritingEdge,
    panWorkspaceBy,
  };
}
