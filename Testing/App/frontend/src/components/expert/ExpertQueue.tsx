import { ExpertSelect } from '@/components/expert/ExpertSelect';
import { expertWorkStatus } from '@/lib/expert';
import { gridCounts, gridWorkLabel } from '@/lib/grid-view';
import { ArrowRight, ChevronRight, Search } from 'lucide-react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EXPERT, EXPERT_COPY as COPY } from '@/config/expert';
import { EXPERT_UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { type GridUi, type GridWorkspace } from '@/hooks/use-grid-ui';
import { cn } from '@/lib/utils';

export function ExpertQueue({ workspace, ui }: { workspace: GridWorkspace; ui: GridUi }) {
  const styles = layout.expert;
  const counts = gridCounts(workspace.allWorks);
  const firstWork = workspace.works[0];

  return (
    <main className={styles.queue}>
      <div className={styles.queueIntro}>
        <div className={styles.queueHeading}>
          <ScreenHeading title={COPY.queueTitle} subtitle={COPY.queueSubtitle} variant="app" />
        </div>
        <Button
          disabled={!firstWork || workspace.busy}
          onClick={() => firstWork && ui.openWork(firstWork.id)}
          className={styles.queueStart}
        >
          {COPY.queueStart}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      <div className={styles.stack}>
        <div className={styles.queueTabs}>
          <div className={styles.tabs}>
            {EXPERT_UI.filters.map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={cn(styles.filter, workspace.filter === filter.id && styles.filterActive)}
                aria-pressed={workspace.filter === filter.id}
                onClick={() => workspace.setFilter(filter.id)}
              >
                {filter.label}
                <span className={styles.count}>{counts[filter.id]}</span>
              </button>
            ))}
          </div>
          <div className={styles.queueControls}>
            <div className={styles.queueSearch}>
              <Search className={styles.queueSearchIcon} aria-hidden="true" />
              <Input
                type="search"
                value={workspace.query}
                onChange={(event) => workspace.setQuery(event.target.value)}
                aria-label={COPY.queueSearch}
                placeholder={COPY.queueSearch}
                className={styles.queueSearchInput}
              />
            </div>
            <ExpertSelect
              className={styles.queueSortRoot}
              value={workspace.sort}
              onChange={(event) =>
                workspace.setSort(event.target.value === 'newest' ? 'newest' : 'oldest')
              }
              ariaLabel={COPY.queueSort}
            >
              {EXPERT.sortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </ExpertSelect>
          </div>
        </div>
        <div className={styles.queueTable}>
          <div className={cn(styles.queueColumns, styles.queueGridColumns)} aria-hidden="true">
            {EXPERT_UI.workColumns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {workspace.works.map((work) => (
            <button
              key={work.id}
              type="button"
              className={cn(styles.studentRow, styles.queueGridColumns)}
              onClick={() => ui.openWork(work.id)}
            >
              <span className={styles.studentIdentity}>
                <span className={styles.studentAvatar}>{work.student.initials}</span>
                <span className={styles.studentText}>
                  <span className={styles.studentName}>{work.student.name}</span>
                  <span className={styles.studentMobile}>
                    {gridWorkLabel(work)} · {work.submittedAt}
                  </span>
                </span>
              </span>
              <span className={styles.studentCell}>{work.subject}</span>
              <span className={styles.studentTasks}>{gridWorkLabel(work)}</span>
              <span className={styles.studentCell}>{work.submittedAt}</span>
              <span className={styles.studentEnd}>
                <span className={cn(styles.status, styles.studentStatus)}>
                  <span
                    className={cn(
                      styles.statusDot,
                      styles.queueStatusTones[expertWorkStatus(work).tone],
                    )}
                  />
                  <span className={styles.studentStatusLabel}>{expertWorkStatus(work).label}</span>
                </span>
                <ChevronRight className={styles.icon} aria-hidden="true" />
              </span>
            </button>
          ))}
          {!workspace.works.length ? (
            <div className={styles.queueEmpty} role="status">
              <ScreenHeading
                title={
                  workspace.query
                    ? COPY.queueEmptyTitle
                    : workspace.filter === 'pending'
                      ? COPY.noPending
                      : COPY.noReviewed
                }
                variant="task"
                as="h2"
              />
              <p className={styles.queueEmptyText}>
                {workspace.query
                  ? COPY.queueEmptyHint
                  : workspace.filter === 'pending'
                    ? COPY.noPendingHint
                    : COPY.noReviewedHint}
              </p>
              {workspace.query ? (
                <Button variant="outline" onClick={() => workspace.setQuery('')}>
                  {COPY.queueReset}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
