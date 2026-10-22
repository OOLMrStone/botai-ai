'use client';

import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { sheetGestures, sheetMotion } from '@/config/motion';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { capturePointer } from '@/lib/pointer-capture';

interface SheetSwipeOptions {
  enabled: boolean;
  onClose: () => void;
}

interface DragAnchor {
  pointerId: number;
  startY: number;
  startOffset: number;
  lastY: number;
  lastTime: number;
  sheetHeight: number;
  backdropOpacity: number;
  distance: number;
  velocity: number;
}

interface PointerSample {
  pointerId: number;
  clientY: number;
  timeStamp: number;
}

function translateY(transform: string) {
  if (transform === 'none') return 0;
  const matrix = transform.match(/^matrix\((.+)\)$/)?.[1].split(',');
  if (matrix) return Number(matrix[5]) || 0;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/)?.[1].split(',');
  return matrix3d ? Number(matrix3d[13]) || 0 : 0;
}

export function useSheetSwipe({ enabled, onClose }: SheetSwipeOptions) {
  const popupRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<DragAnchor | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const suppressClickRef = useRef(false);
  const closeRunRef = useRef(0);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const clickResetFrameRef = useRef<number | null>(null);
  useGestureSurfaceGuard(handleRef, { enabled });

  const cancelAnimations = () => {
    const popup = popupRef.current;
    const backdrop = backdropRef.current;
    const popupAnimations = popup?.getAnimations() ?? [];
    const backdropAnimations = backdrop?.getAnimations() ?? [];
    if (popup && popupAnimations.length) {
      const transform = getComputedStyle(popup).transform;
      popup.style.transform = transform === 'none' ? '' : transform;
    }
    if (backdrop && backdropAnimations.length) {
      backdrop.style.opacity = getComputedStyle(backdrop).opacity;
    }
    [...popupAnimations, ...backdropAnimations].forEach((animation) => animation.cancel());
    animationsRef.current = [];
  };

  const clearStyles = () => {
    popupRef.current?.style.removeProperty('transform');
    backdropRef.current?.style.removeProperty('opacity');
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    if (clickResetFrameRef.current !== null) cancelAnimationFrame(clickResetFrameRef.current);
    clickResetFrameRef.current = requestAnimationFrame(() => {
      suppressClickRef.current = false;
      clickResetFrameRef.current = null;
    });
  };

  const animateRelease = async (close: boolean) => {
    const popup = popupRef.current;
    const backdrop = backdropRef.current;
    if (!popup || !backdrop) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const closeRun = closeRunRef.current + 1;
    closeRunRef.current = closeRun;
    cancelAnimations();

    if (reducedMotion) {
      clearStyles();
      if (close) onClose();
      return;
    }

    const popupTransform = getComputedStyle(popup).transform;
    const backdropOpacity = getComputedStyle(backdrop).opacity;
    const targetTransform = close
      ? `translate3d(0, ${popup.getBoundingClientRect().height}px, 0)`
      : 'translate3d(0, 0, 0)';
    const popupAnimation = popup.animate(
      [{ transform: popupTransform }, { transform: targetTransform }],
      {
        duration: close ? sheetMotion.dismissMs : sheetMotion.snapBackMs,
        easing: sheetMotion.releaseEasing,
        fill: 'forwards',
      },
    );
    const backdropAnimation = backdrop.animate(
      [{ opacity: backdropOpacity }, { opacity: close ? 0 : 1 }],
      {
        duration: close ? sheetMotion.dismissMs : sheetMotion.snapBackMs,
        easing: sheetMotion.releaseEasing,
        fill: 'forwards',
      },
    );
    animationsRef.current = [popupAnimation, backdropAnimation];

    await popupAnimation.finished.catch(() => undefined);
    if (closeRun !== closeRunRef.current) return;
    popupAnimation.cancel();
    backdropAnimation.cancel();
    animationsRef.current = [];
    clearStyles();
    if (close) onClose();
  };

  const move = (event: PointerSample & { preventDefault: () => void }) => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    const backdrop = backdropRef.current;
    if (!anchor || anchor.pointerId !== event.pointerId || !popup || !backdrop) return;
    event.preventDefault();

    const distance = Math.max(0, anchor.startOffset + event.clientY - anchor.startY);
    const elapsed = event.timeStamp - anchor.lastTime;
    const velocity = elapsed > 0 ? (event.clientY - anchor.lastY) / elapsed : anchor.velocity;
    const progress = Math.min(1, distance / anchor.sheetHeight);
    popup.style.transform = `translate3d(0, ${distance}px, 0)`;
    backdrop.style.opacity = String(anchor.backdropOpacity * (1 - progress));
    anchorRef.current = {
      ...anchor,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      distance,
      velocity,
    };
  };

  const finish = (event: PointerSample) => {
    const anchor = anchorRef.current;
    if (!anchor || anchor.pointerId !== event.pointerId) return;
    anchorRef.current = null;

    const pointerDistance = Math.max(0, anchor.startOffset + event.clientY - anchor.startY);
    const finalDistance = Math.max(anchor.distance, pointerDistance);
    const elapsed = event.timeStamp - anchor.lastTime;
    const releaseVelocity = elapsed > 0 ? (event.clientY - anchor.lastY) / elapsed : 0;
    const finalVelocity = Math.max(anchor.velocity, releaseVelocity);
    const pointerTravel = Math.max(
      Math.abs(event.clientY - anchor.startY),
      Math.abs(anchor.lastY - anchor.startY),
    );
    const dragged = pointerTravel >= sheetGestures.dragSlopPx;
    if (!dragged) {
      clearStyles();
      return;
    }
    const dismiss =
      finalDistance >= anchor.sheetHeight * sheetGestures.dismissDistanceRatio ||
      finalVelocity >= sheetGestures.dismissVelocityPxMs;
    suppressNextClick();
    void animateRelease(dismiss);
  };

  const cancel = (event: PointerSample) => {
    const anchor = anchorRef.current;
    if (!anchor || anchor.pointerId !== event.pointerId) return;
    anchorRef.current = null;
    const dragged = Math.abs(anchor.lastY - anchor.startY) >= sheetGestures.dragSlopPx;
    if (dragged) suppressNextClick();
    if (!dragged) {
      clearStyles();
      return;
    }
    void animateRelease(false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    closeRunRef.current += 1;
    cancelAnimations();
    const popup = popupRef.current;
    const backdrop = backdropRef.current;
    if (!popup || !backdrop) return;
    const startOffset = Math.max(0, translateY(getComputedStyle(popup).transform));
    capturePointer(event.currentTarget, event.pointerId);
    anchorRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      sheetHeight: popup.getBoundingClientRect().height,
      backdropOpacity: Number(getComputedStyle(backdrop).opacity),
      distance: startOffset,
      velocity: 0,
    };

    stopListeningRef.current?.();
    const onMove = (pointerEvent: PointerEvent) => move(pointerEvent);
    const onFinish = (pointerEvent: PointerEvent) => {
      if (anchorRef.current?.pointerId !== pointerEvent.pointerId) return;
      stopListening();
      finish(pointerEvent);
    };
    const onCancel = (pointerEvent: PointerEvent) => {
      if (anchorRef.current?.pointerId !== pointerEvent.pointerId) return;
      stopListening();
      cancel(pointerEvent);
    };
    const stopListening = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onCancel);
      if (stopListeningRef.current === stopListening) stopListeningRef.current = null;
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onCancel);
    stopListeningRef.current = stopListening;
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (anchorRef.current?.pointerId !== event.pointerId) return;
    stopListeningRef.current?.();
    cancel(event);
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (clickResetFrameRef.current !== null) cancelAnimationFrame(clickResetFrameRef.current);
      clickResetFrameRef.current = null;
      return;
    }
    onClose();
  };

  useEffect(
    () => () => {
      closeRunRef.current += 1;
      stopListeningRef.current?.();
      if (clickResetFrameRef.current !== null) cancelAnimationFrame(clickResetFrameRef.current);
      animationsRef.current.forEach((animation) => animation.cancel());
    },
    [],
  );

  return {
    popupRef,
    backdropRef,
    handleProps: {
      ref: handleRef,
      onClick,
      onPointerDown,
      onLostPointerCapture,
    },
  };
}
