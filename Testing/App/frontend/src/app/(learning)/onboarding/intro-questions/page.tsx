'use client';

import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';
import { Button } from '@/components/ui/button';
import { HighlightText } from '@/components/onboarding/HighlightText';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';

export default function IntroQuestionsPage() {
  const { goNext } = useOnboardingFlow('intro-questions');

  return (
    <ScreenShell
      center
      footer={
        <Button className={layout.cta} size="default" onClick={() => goNext()}>
          {COPY.introQuestions.action}
        </Button>
      }
    >
      <EmbeddedBo animation={LEMUR_ANIMATIONS.sit} />
      <ScreenHeading title={<HighlightText text={COPY.introQuestions.title} />} />
    </ScreenShell>
  );
}
