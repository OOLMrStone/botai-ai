'use client';

import { useEffect } from 'react';

import { isEditableGestureTarget } from '@/lib/gesture-surface';

import type { RefObject } from 'react';

interface GestureSurfaceGuardOptions {
  enabled?: boolean;
  preventTouchDefaults?: boolean;
}

export function useGestureSurfaceGuard<T extends HTMLElement>(
  surfaceRef: RefObject<T | null>,
  { enabled = true, preventTouchDefaults = false }: GestureSurfaceGuardOptions = {},
) {
  useEffect(() => {
    if (!enabled) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    const preventSelection = (event: Event) => {
      if (!isEditableGestureTarget(event.target) && event.cancelable) event.preventDefault();
    };
    const preventTouch = (event: TouchEvent) => {
      if (!isEditableGestureTarget(event.target) && event.cancelable) event.preventDefault();
    };

    surface.addEventListener('selectstart', preventSelection, { capture: true });
    if (preventTouchDefaults) {
      surface.addEventListener('touchstart', preventTouch, { passive: false });
      surface.addEventListener('touchmove', preventTouch, { passive: false });
    }

    return () => {
      surface.removeEventListener('selectstart', preventSelection, { capture: true });
      if (preventTouchDefaults) {
        surface.removeEventListener('touchstart', preventTouch);
        surface.removeEventListener('touchmove', preventTouch);
      }
    };
  }, [enabled, preventTouchDefaults, surfaceRef]);
}
