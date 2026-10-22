'use client';

import { Lock } from 'lucide-react';

import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import type { FeatureId } from '@/config/plans';
import { useHasFeature } from '@/hooks/use-plan';

// Гейт платной фичи: с подходящим тарифом показываем содержимое, без него -
// замок с подписью. Единственный способ закрыть что-то тарифом.
export function PlanGate({ feature, children }: { feature: FeatureId; children: React.ReactNode }) {
  const allowed = useHasFeature(feature);

  if (allowed) return <>{children}</>;

  return (
    <div className={layout.app.planGate.root}>
      <Lock className={layout.app.planGate.icon} />
      <span>{COPY.plan.locked}</span>
    </div>
  );
}
