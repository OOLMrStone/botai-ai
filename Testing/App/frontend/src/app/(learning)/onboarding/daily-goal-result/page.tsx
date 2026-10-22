'use client';

import { ResultScreen } from '@/components/onboarding/ResultScreen';
import { COPY } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';

export default function DailyGoalResultPage() {
  const { goNext } = useOnboardingFlow('daily-goal-result');

  return (
    <ResultScreen
      title={COPY.dailyGoalResult.title}
      subtitle={COPY.dailyGoalResult.subtitle}
      actionLabel={COPY.dailyGoalResult.action}
      onAction={() => goNext()}
    />
  );
}
