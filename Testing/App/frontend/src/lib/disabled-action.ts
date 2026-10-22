import type { Button as ButtonPrimitive } from '@base-ui/react/button';

// Пояснение доступно для нажатия, но исходное действие и отправка формы запрещены.
export function explainButtonProps(props: ButtonPrimitive.Props, reason?: string) {
  if (!props.disabled || !reason) return props;
  return {
    ...props,
    disabled: false,
    'aria-disabled': true,
    type: 'button' as const,
    nativeButton: true,
    render: undefined,
    onClick: undefined,
    onClickCapture: undefined,
    onDoubleClick: undefined,
    onDoubleClickCapture: undefined,
    onAuxClick: undefined,
    onAuxClickCapture: undefined,
    onKeyDown: undefined,
    onKeyDownCapture: undefined,
    onKeyUp: undefined,
    onKeyUpCapture: undefined,
    onPointerDown: undefined,
    onPointerDownCapture: undefined,
    onPointerUp: undefined,
    onPointerUpCapture: undefined,
    onMouseDown: undefined,
    onMouseDownCapture: undefined,
    onMouseUp: undefined,
    onMouseUpCapture: undefined,
    onTouchStart: undefined,
    onTouchStartCapture: undefined,
    onTouchEnd: undefined,
    onTouchEndCapture: undefined,
  };
}
