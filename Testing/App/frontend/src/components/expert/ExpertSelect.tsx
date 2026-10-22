import type { ChangeEventHandler, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function ExpertSelect({
  value,
  onChange,
  children,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <span className={cn(layout.expert.selectRoot, className)}>
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className={cn(layout.control.input, layout.expert.select)}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className={layout.expert.selectIcon} />
    </span>
  );
}
