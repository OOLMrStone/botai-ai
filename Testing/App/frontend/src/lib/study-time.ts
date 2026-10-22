import { STREAK_FORMAT, STUDY_TIME } from '@/config/user-stats';

export function formatStudyTime(totalMinutes: number) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / STUDY_TIME.minutesPerHour);
  const minutes = rounded % STUDY_TIME.minutesPerHour;

  return hours ? STUDY_TIME.hoursLabel(hours, minutes) : STUDY_TIME.minutesLabel(minutes);
}

export function formatStreakDays(days: number) {
  return `${days} ${STREAK_FORMAT.units[STREAK_FORMAT.plural.select(days)]}`;
}
