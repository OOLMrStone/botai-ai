import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface ScreenShellProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  center?: boolean;
  bottomNavigation?: boolean;
  scrollPage?: boolean;
  className?: string;
}

// Общий каркас экрана: контент + прижатый снизу блок действий. Размеры - из layout.
export function ScreenShell({
  children,
  footer,
  center = false,
  bottomNavigation = false,
  scrollPage = false,
  className,
}: ScreenShellProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        !scrollPage && layout.shell.padX,
        !scrollPage && (bottomNavigation ? layout.shell.padTopWithNav : layout.shell.padTop),
        !scrollPage && (bottomNavigation ? layout.shell.padBottomWithNav : layout.shell.padBottom),
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          layout.shell.gap,
          scrollPage && layout.scroll,
          scrollPage && layout.shell.padX,
          scrollPage && layout.shell.padTopWithNav,
          center ? 'items-center justify-center text-center' : 'justify-start',
        )}
      >
        {children}
      </div>

      {footer ? <div className={layout.shell.footerTop}>{footer}</div> : null}
    </div>
  );
}
