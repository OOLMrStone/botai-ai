import type { ReactElement } from 'react';
import { Popover } from '@base-ui/react/popover';
import { SolutionPointDetail } from '@/components/experimental/SolutionPointDetail';
import type { ExperimentalPoint, ExperimentalPointId } from '@/config/experimental';
import { layout } from '@/config/layout';

interface SolutionPointPopoverProps {
  point: ExperimentalPoint;
  open: boolean;
  hoverEnabled: boolean;
  disputed: boolean;
  onPointOpen: (id: ExperimentalPointId, open: boolean) => void;
  onDispute: () => void;
  children: ReactElement;
}

export function SolutionPointPopover({
  point,
  open,
  hoverEnabled,
  disputed,
  onPointOpen,
  onDispute,
  children,
}: SolutionPointPopoverProps) {
  const styles = layout.experimentalSolution;

  return (
    <Popover.Root
      open={open}
      triggerId={point.elementId}
      onOpenChange={(nextOpen) => onPointOpen(point.id, nextOpen)}
    >
      <Popover.Trigger
        id={point.elementId}
        render={children}
        openOnHover={hoverEnabled && Boolean(point.formattingNote)}
        delay={styles.popover.hoverDelay}
        closeDelay={styles.popover.closeDelay}
      />
      <Popover.Portal>
        <Popover.Positioner
          side="right"
          align="start"
          sideOffset={styles.popover.sideOffset}
          collisionPadding={styles.popover.collisionPadding}
          positionMethod="fixed"
          className={styles.popoverPositioner}
        >
          <Popover.Popup
            initialFocus={false}
            aria-label={point.title}
            className={styles.popoverSurface}
          >
            <SolutionPointDetail point={point} disputed={disputed} onDispute={onDispute} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
