'use client';

import { Radio } from '@base-ui/react/radio';
import type { ComponentType } from 'react';

import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface SelectableCardProps {
  value: string;
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}

// Крупная карточка-вариант на семантике radio (a11y). Рендерится внутри RadioGroup.
export function SelectableCard({
  value,
  label,
  description,
  icon: Icon,
  className,
}: SelectableCardProps) {
  return (
    <Radio.Root
      value={value}
      className={cn(
        layout.option.root,
        'transition-[background-color,border-color,transform] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
        'hover:bg-muted/65 focus-visible:ring-ring/50 focus-visible:ring-3',
        'data-checked:border-ring/35 data-checked:bg-muted',
        className,
      )}
    >
      {Icon ? (
        <span className={layout.option.iconFrame}>
          <Icon className={layout.option.icon} />
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className={cn('block', layout.typography.controlTitle)}>{label}</span>
        {description ? (
          <span className={cn(layout.option.description, layout.typography.description)}>
            {description}
          </span>
        ) : null}
      </span>

      <span className={layout.option.indicator}>
        <Radio.Indicator className={layout.option.indicatorFill} />
      </span>
    </Radio.Root>
  );
}
