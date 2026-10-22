import { INTEGRATION } from '@/config/integration';
import { TASK_COPY } from '@/config/tasks';
import type { Task } from '@/lib/api/learning-types';

export function favoriteTrainingBatch(tasks: Task[]) {
  return {
    tasks: tasks.slice(0, INTEGRATION.maxTasks),
    label:
      tasks.length > INTEGRATION.maxTasks
        ? TASK_COPY.favorites.limited(INTEGRATION.maxTasks)
        : TASK_COPY.favorites.all,
  };
}
