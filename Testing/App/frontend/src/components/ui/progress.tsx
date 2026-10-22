'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { MOTION_STYLES } from '@/config/motion';
import { cn } from '@/lib/utils';

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const numericValue = typeof value === 'number' ? value : min;
  const scale = max === min ? 0 : Math.min(1, Math.max(0, (numericValue - min) / (max - min)));

  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn('flex flex-wrap gap-3', className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <div
          data-slot="progress-indicator"
          className={cn(
            'bg-primary h-full w-full origin-left transition-transform duration-[var(--progress-motion-duration)] ease-out motion-reduce:transition-none',
            MOTION_STYLES.progressEnter,
          )}
          style={{ transform: `scaleX(${scale})` }}
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        'bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full',
        className,
      )}
      data-slot="progress-track"
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn('text-sm font-medium', className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn('text-muted-foreground ml-auto text-sm tabular-nums', className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

export { Progress, ProgressTrack, ProgressLabel, ProgressValue };
