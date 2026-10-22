import type { ComponentType } from 'react';

import { AppCard } from '@/components/app/AppCard';
import { cn } from '@/lib/utils';
import { layout } from '@/config/layout';

interface StatTileProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

// Плитка сводки в «Обзоре» профиля: иконка + подпись + значение.
export function StatTile({ icon: Icon, label, value }: StatTileProps) {
  return (
    <AppCard className={cn(layout.app.card.compact, layout.app.profile.card)}>
      <div className={cn(layout.app.profile.metricLabel, layout.typography.description)}>
        <Icon className={layout.app.profile.metricIcon} />
        {label}
      </div>
      <p className={cn(layout.typography.value, layout.app.profile.metricValue)}>{value}</p>
    </AppCard>
  );
}
