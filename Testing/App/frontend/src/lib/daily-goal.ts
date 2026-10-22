import { DAILY_GOAL_OPTIONS, DEFAULT_DAILY_GOAL_MINUTES } from '@/config/onboarding-steps';

const LEGACY_DAILY_GOAL_MAP: Record<number, number> = {
  5: 15,
  10: 15,
  15: 15,
  20: 30,
};

export function normalizeDailyGoalMinutes(minutes: number): number {
  const legacyValue = LEGACY_DAILY_GOAL_MAP[minutes];
  if (legacyValue !== undefined) return legacyValue;

  return DAILY_GOAL_OPTIONS.reduce(
    (nearest, option) =>
      Math.abs(option.minutes - minutes) < Math.abs(nearest - minutes) ? option.minutes : nearest,
    DEFAULT_DAILY_GOAL_MINUTES,
  );
}
