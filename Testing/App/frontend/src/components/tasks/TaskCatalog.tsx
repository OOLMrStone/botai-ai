'use client';

import { History, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';

import { ErrorNote } from '@/components/common/ErrorNote';
import { ExamNumberCard } from '@/components/tasks/ExamNumberCard';
import { FavoritesGrid } from '@/components/tasks/FavoritesGrid';
import { TaskCatalogTabs } from '@/components/tasks/TaskCatalogTabs';
import { Button } from '@/components/ui/button';
import { LEARNING_COPY, LEARNING_ROUTES } from '@/config/integration';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import { useTaskCatalog } from '@/hooks/use-task-catalog';
import { useTaskCatalogScroll } from '@/hooks/use-task-catalog-scroll';
import type { Task } from '@/lib/api/learning-types';
import { cn } from '@/lib/utils';

export function TaskCatalog({ tasks }: { tasks: Task[] }) {
  const catalog = useTaskCatalog(tasks);
  const { scrollRef, onScroll } = useTaskCatalogScroll(
    Boolean(catalog.catalog.data) &&
      (catalog.view !== 'favorites' || Boolean(catalog.favoriteTasks)),
  );

  return (
    <div className={layout.tasks.catalog}>
      <div className={layout.tasks.catalogHeader}>
        <div className={layout.tasks.catalogActions}>
          <Button
            variant="outline"
            size="compact"
            className={layout.tasks.catalogBuilder}
            onClick={catalog.openSetup}
            disabled={catalog.busy}
          >
            <SlidersHorizontal className={layout.tasks.icon} />
            {TASK_COPY.catalog.builder}
          </Button>
          <Link
            href={LEARNING_ROUTES.history}
            className={layout.tasks.catalogSecondary}
            aria-label={LEARNING_COPY.history}
          >
            <History className={layout.tasks.icon} />
            <span className={layout.tasks.historyLabel}>{LEARNING_COPY.history}</span>
          </Link>
        </div>
        <TaskCatalogTabs view={catalog.view} onChange={catalog.setView} />
      </div>
      <div
        ref={scrollRef}
        className={cn(layout.scroll, layout.tasks.catalogScroll)}
        onScroll={onScroll}
      >
        {catalog.catalog.failed ? (
          <ErrorNote message={LEARNING_COPY.loadError} onRetry={catalog.catalog.retry} />
        ) : null}
        {catalog.favorites.failed && catalog.view === 'favorites' ? (
          <ErrorNote message={LEARNING_COPY.loadError} onRetry={catalog.favorites.retry} />
        ) : null}
        {catalog.error ? <ErrorNote message={catalog.error} /> : null}
        {catalog.view === 'favorites' ? (
          <FavoritesGrid
            tasks={catalog.favoriteTasks ?? []}
            disabled={catalog.busy}
            onOpenAll={() => void catalog.openFavorites(catalog.favoriteTasks ?? [])}
            onOpenTask={(task) => void catalog.openFavorites([task])}
          />
        ) : (
          <div className={layout.tasks.grid}>
            {catalog.numbers.map(({ number, tasks: numberTasks }) => (
              <ExamNumberCard
                key={number.examNumber}
                number={number}
                tasks={numberTasks}
                disabled={catalog.busy}
                loading={catalog.busy && catalog.openingNumber === number.examNumber}
                onOpen={() => void catalog.openNumber(number.examNumber)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
