'use client';

import { QuestionScreen } from '@/components/onboarding/QuestionScreen';
import { COPY, LEVEL_OPTIONS } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function LevelPage() {
  const { goNext } = useOnboardingFlow('level');
  const level = useOnboardingStore((s) => s.level);
  const setLevel = useOnboardingStore((s) => s.setLevel);

  return (
    <QuestionScreen
      title={COPY.level.title}
      subtitle={COPY.level.subtitle}
      options={LEVEL_OPTIONS}
      value={level}
      onValueChange={setLevel}
      actionLabel={COPY.level.action}
      onContinue={() => goNext()}
    />
  );
}
