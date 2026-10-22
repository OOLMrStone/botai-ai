'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CommitmentSeal } from '@/components/onboarding/CommitmentSeal';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { cn } from '@/lib/utils';

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export default function CommitmentPage() {
  const { goNext } = useOnboardingFlow('commitment');
  const [sealed, setSealed] = useState(false);

  const today = DATE_FMT.format(new Date());

  return (
    <ScreenShell
      footer={
        <Button
          className={cn(
            layout.cta,
            layout.commitment.footer,
            sealed ? layout.commitment.footerVisible : layout.commitment.footerHidden,
          )}
          size="default"
          disabled={!sealed}
          tabIndex={sealed ? 0 : -1}
          onClick={() => goNext()}
        >
          {COPY.commitment.action}
        </Button>
      }
    >
      <ScreenHeading title={COPY.commitment.title} />

      <p className="text-lg text-balance whitespace-pre-line">{COPY.commitment.subtitle}</p>

      <CommitmentSeal date={today} onSealChange={setSealed} />
    </ScreenShell>
  );
}
