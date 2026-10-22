'use client';

import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';

export default function ThankYouPage() {
  const { goNext } = useOnboardingFlow('thank-you');

  return (
    <ScreenShell
      center
      footer={
        <Button className={layout.cta} size="default" onClick={() => goNext()}>
          {COPY.thankYou.action}
        </Button>
      }
    >
      <div className={layout.surface.illustration}>
        <ShieldCheck className="size-8" />
      </div>

      <ScreenHeading title={COPY.thankYou.title} />

      <div className={layout.surface.centeredSummary}>
        <p className="font-medium whitespace-pre-line">{COPY.thankYou.cardTitle}</p>
        <p className="text-muted-foreground text-sm text-balance whitespace-pre-line">
          {COPY.thankYou.cardText}
        </p>
      </div>
    </ScreenShell>
  );
}
