export const TASK_KEYBOARD = {
  directions: { ArrowLeft: -1, ArrowRight: 1 },
  firstIndex: 0,
  nativeControlSelector:
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="menu"], [role="listbox"], [role="tablist"]',
  modalSelector:
    'dialog[open], [role="dialog"][data-open], [role="alertdialog"][data-open], [aria-modal="true"]:not([hidden])',
} as const;
