import type { DailyTask } from '@/config/daily-tasks';

const MS_IN_DAY = 24 * 60 * 60 * 1000;

// Задача дня: номер календарного дня по кругу пула. Один и тот же день - одна и
// та же задача (у всех и при каждой перезагрузке), следующий день - следующая.
// День берём локальный, чтобы задача менялась в полночь пользователя.
export function pickDailyTask(tasks: DailyTask[], date: Date): DailyTask {
  const localDay = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_IN_DAY,
  );

  return tasks[localDay % tasks.length];
}
