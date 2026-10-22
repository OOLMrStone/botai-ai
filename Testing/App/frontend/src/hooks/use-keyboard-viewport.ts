'use client';

import { useEffect } from 'react';

import { KEYBOARD_VIEWPORT } from '@/config/constants';

export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;

    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editing = document.activeElement?.matches(KEYBOARD_VIEWPORT.editableSelector);
        document.documentElement.toggleAttribute(
          KEYBOARD_VIEWPORT.keyboardAttribute,
          Boolean(
            editing && window.innerHeight - viewport.height > KEYBOARD_VIEWPORT.minimumOcclusionPx,
          ),
        );
        document.documentElement.style.setProperty(
          KEYBOARD_VIEWPORT.heightProperty,
          `${viewport.height}px`,
        );
        document.documentElement.style.setProperty(
          KEYBOARD_VIEWPORT.offsetProperty,
          `${viewport.offsetTop}px`,
        );
      });
    };

    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    document.addEventListener('focusin', syncViewport);
    document.addEventListener('focusout', syncViewport);
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty(KEYBOARD_VIEWPORT.heightProperty);
      document.documentElement.style.removeProperty(KEYBOARD_VIEWPORT.offsetProperty);
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
      document.removeEventListener('focusin', syncViewport);
      document.removeEventListener('focusout', syncViewport);
      document.documentElement.removeAttribute(KEYBOARD_VIEWPORT.keyboardAttribute);
    };
  }, []);
}
