'use client';

import { useEffect, useRef } from 'react';

export function useSetupDismiss(onClose: () => void) {
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    screenRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onClose]);

  return screenRef;
}
