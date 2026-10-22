'use client';

import { useEffect, useRef } from 'react';

import { isNavigationKeyBlocked } from '@/lib/task-keyboard';

import { TASK_KEYBOARD } from '@/config/task-keyboard';

interface TaskKeyboardNavigationOptions {
  currentIndex: number;
  lastIndex: number;
  enabled: boolean;
  onSelect: (index: number) => void;
}

export function useTaskKeyboardNavigation({
  currentIndex,
  lastIndex,
  enabled,
  onSelect,
}: TaskKeyboardNavigationOptions) {
  const pointers = useRef(new Set<number>());

  useEffect(() => {
    if (!enabled) return;

    const navigate = (event: KeyboardEvent) => {
      if (
        isNavigationKeyBlocked(event) ||
        pointers.current.size > 0 ||
        document.querySelector(TASK_KEYBOARD.modalSelector)
      )
        return;

      const target = event.target;
      if (target instanceof Element && target.closest(TASK_KEYBOARD.nativeControlSelector)) return;

      const direction =
        TASK_KEYBOARD.directions[event.key as keyof typeof TASK_KEYBOARD.directions];
      if (direction === undefined) return;

      const nextIndex = currentIndex + direction;
      if (nextIndex < TASK_KEYBOARD.firstIndex || nextIndex > lastIndex) return;

      event.preventDefault();
      onSelect(nextIndex);
    };

    const pointerDown = (event: PointerEvent) => pointers.current.add(event.pointerId);
    const pointerEnd = (event: PointerEvent) => pointers.current.delete(event.pointerId);
    const releasePointers = () => pointers.current.clear();
    window.addEventListener('keydown', navigate);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', pointerEnd, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('blur', releasePointers);
    return () => {
      window.removeEventListener('keydown', navigate);
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('blur', releasePointers);
    };
  }, [currentIndex, lastIndex, enabled, onSelect]);
}
