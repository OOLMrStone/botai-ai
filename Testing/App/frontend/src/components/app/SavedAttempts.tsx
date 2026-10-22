'use client';

import { ArrowUpRight, BookOpen } from 'lucide-react';
import { AppCard, AppCardHeading } from '@/components/app/AppCard';
import { AttemptCard } from '@/components/app/AttemptCard';
import { ErrorNote } from '@/components/common/ErrorNote';
import { SectionHeading } from '@/components/common/SectionHeading';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ATTEMPT_COPY as C, ATTEMPT_FILTERS, ATTEMPT_SKELETONS } from '@/config/attempts';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { useSavedAttempts } from '@/hooks/use-saved-attempts';
import { useHomeAttemptCapacity } from '@/hooks/use-home-attempt-capacity';
import { cn } from '@/lib/utils';

export function SavedAttempts({ history = false }: { history?: boolean }) {
  const list = useSavedAttempts(history);
  const { listRef, visibleCount, renderCount } = useHomeAttemptCapacity(
    !history,
    list.cards?.map(({ attempt }) => attempt.id) ?? [],
  );

  return (
    <section
      className={layout.app.attempts.root}
      aria-label={history ? LEARNING_COPY.history : C.homeTitle}
    >
      <div className={layout.app.attempts.toolbar}>
        {history ? (
          <div className={layout.app.attempts.filters}>
            {ATTEMPT_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                variant={list.filter === filter.id ? 'default' : 'ghost'}
                size="compact"
                aria-pressed={list.filter === filter.id}
                onClick={() => list.setFilter(filter.id)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        ) : (
          <>
            <SectionHeading>{C.homeTitle}</SectionHeading>
            <Button variant="ghost" size="compact" onClick={list.openHistory}>
              {C.historyLink}
              <ArrowUpRight className={layout.app.attempts.icon} aria-hidden="true" />
            </Button>
          </>
        )}
      </div>

      <div
        ref={listRef}
        className={
          history || !list.cards?.length ? layout.app.attempts.list : layout.app.home.attemptList
        }
      >
        {list.failed ? (
          <ErrorNote message={LEARNING_COPY.loadError} onRetry={list.retry} />
        ) : !list.cards ? (
          <div className={layout.app.attempts.loading} role="status" aria-label={C.loadingLabel}>
            {ATTEMPT_SKELETONS.map((key) => (
              <Skeleton key={key} className={layout.app.attempts.skeleton} />
            ))}
          </div>
        ) : list.cards.length ? (
          list.cards.slice(0, renderCount).map(({ attempt, content }, index) => (
            <div
              key={attempt.id}
              className={cn(
                layout.app.home.attemptRow,
                index >= visibleCount && layout.app.home.hiddenAttempt,
              )}
              aria-hidden={index >= visibleCount || undefined}
              inert={index >= visibleCount}
            >
              <AttemptCard attempt={attempt} content={content} onOpen={list.openAttempt} />
            </div>
          ))
        ) : (
          <AppCard className={layout.app.attempts.empty}>
            <BookOpen className={layout.app.attempts.emptyIcon} aria-hidden="true" />
            <AppCardHeading title={list.empty.title} subtitle={list.empty.description} />
            <Button onClick={list.hasAttempts ? () => list.setFilter('all') : list.openCatalog}>
              {list.hasAttempts ? C.showAll : LEARNING_COPY.openCatalog}
            </Button>
          </AppCard>
        )}
      </div>
    </section>
  );
}
