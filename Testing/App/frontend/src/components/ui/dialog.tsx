'use client';

import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { useSheetSwipe } from '@/hooks/use-sheet-swipe';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface DialogSheetProps {
  open: boolean;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  className?: string;
  swipeToClose?: boolean;
  initialFocus?: React.ComponentProps<typeof Dialog.Popup>['initialFocus'];
  onOpenChange: (open: boolean) => void;
}

export function DialogSheet({
  open,
  title,
  closeLabel,
  children,
  headerActions,
  className,
  swipeToClose = false,
  initialFocus,
  onOpenChange,
}: DialogSheetProps) {
  const close = () => onOpenChange(false);
  const { popupRef, backdropRef, handleProps } = useSheetSwipe({
    enabled: open && swipeToClose,
    onClose: close,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop ref={backdropRef} className={layout.sheet.overlay} />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={initialFocus}
          className={cn(layout.sheet.root, layout.sheet.width, className)}
        >
          {swipeToClose ? (
            <button
              type="button"
              className={cn(layout.sheet.grabber, layout.gestureSurface)}
              aria-label={closeLabel}
              onContextMenu={preventGestureContextMenu}
              {...handleProps}
            >
              <span aria-hidden="true" className={layout.sheet.grabberPill} />
            </button>
          ) : null}
          <div className={layout.sheet.header}>
            <Dialog.Title className={layout.sheet.title}>{title}</Dialog.Title>
            <div className={layout.sheet.headerActions}>
              {headerActions}
              <Dialog.Close
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    className={cn(layout.sheet.close, swipeToClose && layout.sheet.desktopClose)}
                    aria-label={closeLabel}
                  />
                }
              >
                <X aria-hidden="true" className={layout.sheet.icon} />
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
