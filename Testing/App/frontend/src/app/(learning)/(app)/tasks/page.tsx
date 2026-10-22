'use client';

import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { TaskCatalog } from '@/components/tasks/TaskCatalog';
import { Skeleton } from '@/components/ui/skeleton';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useTasks } from '@/hooks/use-tasks';

export default function TasksPage() {
  const { tasks, failed, retry } = useTasks();

  return (
    <ScreenShell bottomNavigation className={layout.tasks.content}>
      <ScreenHeading variant="app" title={COPY.tasks.title} />
      {failed ? (
        <div className={layout.scroll}>
          <ErrorNote message={COPY.errors.tasks} onRetry={retry} />
        </div>
      ) : tasks ? (
        <TaskCatalog tasks={tasks} />
      ) : (
        <div className={layout.scroll}>
          <div className={layout.tasks.grid}>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className={layout.tasks.skeleton} />
            ))}
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
