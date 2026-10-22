'use client';

import { QuestionScreen } from '@/components/onboarding/QuestionScreen';
import { COPY, DAILY_GOAL_OPTIONS } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function DailyGoalPage() {
  const { goNext } = useOnboardingFlow('daily-goal');
  const dailyGoalMinutes = useOnboardingStore((s) => s.dailyGoalMinutes);
  const setDailyGoal = useOnboardingStore((s) => s.setDailyGoal);

  return (
    <QuestionScreen
      title={COPY.dailyGoal.title}
      subtitle={COPY.dailyGoal.subtitle}
      options={DAILY_GOAL_OPTIONS}
      value={dailyGoalMinutes === null ? null : String(dailyGoalMinutes)}
      onValueChange={(id) => setDailyGoal(Number(id))}
      actionLabel={COPY.dailyGoal.action}
      onContinue={() => goNext()}
    />
  );
}
