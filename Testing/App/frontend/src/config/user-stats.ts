export const USER_STATS_MOCK = {
  streakDays: 7,
  totalStudyMinutes: 132,
  dailyGoalMinutes: 30,
  dailyProgressMinutes: 12,
  goalId: 'good-plus',
  levelId: 'middle',
} as const;

export const STUDY_TIME = {
  minutesPerHour: 60,
  minutesLabel: (minutes: number) => `${minutes} мин`,
  hoursLabel: (hours: number, minutes: number) =>
    minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`,
} as const;

export const STREAK_FORMAT = {
  plural: new Intl.PluralRules('ru-RU'),
  units: { one: 'день', few: 'дня', many: 'дней', other: 'дней', zero: 'дней', two: 'дня' },
  label: (days: string) => `${days} в ударе`,
} as const;
