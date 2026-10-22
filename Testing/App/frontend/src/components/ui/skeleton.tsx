import { MOTION_STYLES } from '@/config/motion';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-muted rounded-md', MOTION_STYLES.loadingPulse, className)}
      {...props}
    />
  );
}

export { Skeleton };
