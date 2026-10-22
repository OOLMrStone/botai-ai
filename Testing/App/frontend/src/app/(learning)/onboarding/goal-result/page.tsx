'use client';

import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { ResultScreen } from '@/components/onboarding/ResultScreen';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';
import { COPY } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';

export default function GoalResultPage() {
  const { goNext } = useOnboardingFlow('goal-result');

  return (
    <ResultScreen
      mascot={<EmbeddedBo animation={LEMUR_ANIMATIONS.joy} />}
      title={COPY.goalResult.title}
      actionLabel={COPY.goalResult.action}
      onAction={() => goNext()}
    />
  );
}
