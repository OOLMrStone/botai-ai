'use client';

import { ChevronRight } from 'lucide-react';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { PAYWALL_COPY } from '@/config/paywall';
import { usePaywall } from '@/hooks/use-paywall';
import { usePlan } from '@/hooks/use-plan';

export function ProfilePlanCard() {
  const plan = usePlan();
  const paywall = usePaywall();
  return (
    <button
      type="button"
      className={layout.paywall.profileButton}
      onClick={() => paywall.open('profile')}
      aria-label={PAYWALL_COPY.profileAction}
    >
      <span className={layout.paywall.profileText}>
        <span className={layout.typography.description}>{COPY.plan.cardTitle}</span>
        <span className={layout.typography.sectionTitle}>{plan.label}</span>
      </span>
      <ChevronRight aria-hidden="true" className={layout.paywall.icon} />
    </button>
  );
}
