'use client';

import { QuestionScreen } from '@/components/onboarding/QuestionScreen';
import { COPY, GOAL_OPTIONS } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function GoalPage() {
  const { goNext } = useOnboardingFlow('goal');
  const goal = useOnboardingStore((s) => s.goal);
  const setGoal = useOnboardingStore((s) => s.setGoal);

  return (
    <QuestionScreen
      title={COPY.goal.title}
      subtitle={COPY.goal.subtitle}
      options={GOAL_OPTIONS}
      value={goal}
      onValueChange={setGoal}
      actionLabel={COPY.goal.action}
      onContinue={() => goNext()}
    />
  );
}
