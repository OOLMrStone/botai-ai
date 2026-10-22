import type { ReactNode } from 'react';

import { SectionHeading } from '@/components/common/SectionHeading';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function AppCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(layout.app.card.surface, layout.app.card.stack, className)}>{children}</div>
  );
}

export function AppCardHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className={layout.app.card.heading}>
      <SectionHeading>{title}</SectionHeading>
      <p className={layout.typography.description}>{subtitle}</p>
    </div>
  );
}
