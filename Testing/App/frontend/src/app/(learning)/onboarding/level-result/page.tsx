'use client';

import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';
import { ResultScreen } from '@/components/onboarding/ResultScreen';
import { COPY, levelBand } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { useOnboardingStore } from '@/stores/onboarding-store';

const RESULT_BY_BAND = {
  low: COPY.levelResultLow,
  mid: COPY.levelResultMid,
  high: COPY.levelResultHigh,
} as const;

export default function LevelResultPage() {
  const { goNext } = useOnboardingFlow('level-result');
  const level = useOnboardingStore((s) => s.level);

  const copy = RESULT_BY_BAND[levelBand(level ?? 'middle')];

  return (
    <ResultScreen
      mascot={<EmbeddedBo animation={LEMUR_ANIMATIONS.sit} />}
      title={copy.title}
      subtitle={copy.subtitle}
      actionLabel={copy.action}
      onAction={() => goNext()}
    />
  );
}
