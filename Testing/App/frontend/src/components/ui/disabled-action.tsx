'use client';

import { useId, type ReactElement } from 'react';
import { Popover } from '@base-ui/react/popover';
import { DISABLED_ACTION, DISABLED_ACTION_COPY } from '@/config/disabled-action';
import { layout } from '@/config/layout';

export function DisabledAction({ children, reason }: { children: ReactElement; reason: string }) {
  const descriptionId = useId();
  return (
    <Popover.Root>
      <Popover.Trigger render={children} aria-describedby={descriptionId} />
      <Popover.Portal keepMounted>
        <span id={descriptionId} className={layout.disabledAction.hiddenDescription}>
          {reason}
        </span>
        <Popover.Positioner
          side="top"
          sideOffset={DISABLED_ACTION.sideOffset}
          collisionPadding={DISABLED_ACTION.collisionPadding}
          className={layout.disabledAction.positioner}
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            aria-label={DISABLED_ACTION_COPY.explanation}
            className={layout.disabledAction.popup}
          >
            <Popover.Description className={layout.disabledAction.description}>
              {reason}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
