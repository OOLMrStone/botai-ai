import { DAILY_TASKS, type DailyTask } from '@/config/daily-tasks';
import { pickDailyTask } from '@/lib/daily-task';

// Задача дня. Сейчас мок - выбираем из локального пула по дате; позже бэкенд
// будет отдавать задачу под уровень пользователя, экран не поменяется.
export async function fetchDailyTask(): Promise<DailyTask> {
  // TODO: реальный GET задачи дня с бэкенда.
  return pickDailyTask(DAILY_TASKS, new Date());
}
