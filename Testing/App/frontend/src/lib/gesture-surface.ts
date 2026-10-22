import type { MouseEvent as ReactMouseEvent } from 'react';

const EDITABLE_GESTURE_TARGET = 'input, textarea, [contenteditable="true"]';

export function isEditableGestureTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(EDITABLE_GESTURE_TARGET));
}

export function preventGestureContextMenu(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault();
}

export function preventGestureContextMenuOutsideEditable(event: ReactMouseEvent<HTMLElement>) {
  if (isEditableGestureTarget(event.target)) return;

  event.preventDefault();
}
