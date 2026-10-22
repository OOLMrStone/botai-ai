import { Button } from '@/components/ui/button';
import { TaskBlockRenderer } from '@/components/tasks/TaskBlockRenderer';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import type { Task } from '@/lib/api/learning-types';
import { favoriteTrainingBatch } from '@/lib/favorite-training';

interface Props {
  tasks: Task[];
  disabled?: boolean;
  onOpenAll: () => void;
  onOpenTask: (task: Task) => void;
}

export function FavoritesGrid({ tasks, disabled, onOpenAll, onOpenTask }: Props) {
  if (!tasks.length) return <p className={layout.tasks.empty}>{TASK_COPY.favorites.empty}</p>;

  return (
    <div className={layout.tasks.catalogStack}>
      <Button
        variant="outline"
        size="card"
        className={layout.tasks.favoriteAll}
        disabled={disabled}
        onClick={onOpenAll}
      >
        {favoriteTrainingBatch(tasks).label}
      </Button>
      <div className={layout.tasks.grid}>
        {tasks.map((task) => (
          <article key={task.id} className={layout.tasks.favoriteCard}>
            <span className={layout.tasks.favoriteNumber}>
              {TASK_COPY.examNumberPrefix}
              {task.examNumber}
            </span>
            <div className={layout.tasks.favoritePreview}>
              <TaskBlockRenderer blocks={task.content} />
            </div>
            <Button variant="outline" disabled={disabled} onClick={() => onOpenTask(task)}>
              {TASK_COPY.favorites.open}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
