'use client';

import { isNavigationKeyBlocked } from '@/lib/task-keyboard';

import type { KeyboardEvent, PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { taskGestures } from '@/config/layout';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { capturePointer } from '@/lib/pointer-capture';

interface ScrubberInput {
  taskCount: number;
  currentIndex: number;
  onSelect: (index: number) => void;
}

interface PointerAnchor {
  pointerId: number;
  x: number;
  index: number;
  segmentWidth: number;
}

export function useTaskScrubber({ taskCount, currentIndex, onSelect }: ScrubberInput) {
  const scrubberRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<PointerAnchor | null>(null);
  const [precise, setPrecise] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(currentIndex);
  const valueIndex = Math.max(0, Math.min(currentIndex, taskCount - 1));
  useGestureSurfaceGuard(scrubberRef);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const indexAt = (clientX: number) => {
    const rect = scrubberRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.max(0, (clientX - rect.left) / rect.width);

    return Math.min(taskCount - 1, Math.floor(ratio * taskCount));
  };

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (anchor.current?.pointerId !== event.pointerId) return;
    clearHold();
    setPrecise(false);
    anchor.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!taskCount || anchor.current || isNavigationKeyBlocked(event.nativeEvent)) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    if (event.key === 'ArrowLeft') onSelect(Math.max(0, valueIndex - 1));
    if (event.key === 'ArrowRight') onSelect(Math.min(taskCount - 1, valueIndex + 1));
    if (event.key === 'Home') onSelect(0);
    if (event.key === 'End') onSelect(taskCount - 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || anchor.current || !taskCount) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = indexAt(event.clientX);
    capturePointer(event.currentTarget, event.pointerId);
    anchor.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      index,
      segmentWidth: bounds.width / taskCount,
    };
    setPreviewIndex(index);
    clearHold();
    holdTimer.current = setTimeout(() => setPrecise(true), taskGestures.scrubberHoldMs);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!precise || anchor.current?.pointerId !== event.pointerId) return;
    const slowedDelta = (event.clientX - anchor.current.x) * taskGestures.scrubberSlowdown;
    const indexDelta = Math.round(slowedDelta / anchor.current.segmentWidth);
    setPreviewIndex(Math.min(taskCount - 1, Math.max(0, anchor.current.index + indexDelta)));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (anchor.current?.pointerId !== event.pointerId) return;
    clearHold();
    onSelect(precise ? previewIndex : indexAt(event.clientX));
    setPrecise(false);
    anchor.current = null;
  };

  const lensIndices = Array.from(
    { length: taskGestures.scrubberLensRadius * 2 + 1 },
    (_, offset) => previewIndex - taskGestures.scrubberLensRadius + offset,
  ).filter((index) => index >= 0 && index < taskCount);

  return {
    scrubberRef,
    precise,
    previewIndex,
    valueIndex,
    lensIndices,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
}
