import { MOTION_STYLES } from '@/config/motion';
import { cn } from '@/lib/utils';

// Последовательный переход между шагами; экраны вкладок эту обёртку не используют.
export function ScreenTransition({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', MOTION_STYLES.flowEnter)}>{children}</div>
  );
}
