'use client';

import { Check, ChevronDown, ListFilter } from 'lucide-react';
import { useState } from 'react';

import { MockExamCard } from '@/components/mock-exams/MockExamCard';
import { MockExamDetails } from '@/components/mock-exams/MockExamDetails';
import { layout } from '@/config/layout';
import {
  MOCK_EXAM_COPY,
  MOCK_EXAM_LAYOUT,
  type MockExamFilter,
  type MockExamSort,
} from '@/config/mock-exams';
import { useServerExams } from '@/hooks/use-server-exams';
import { ErrorNote } from '@/components/common/ErrorNote';
import { LEARNING_COPY as C } from '@/config/integration';
import { useMockExamSortMenu } from '@/hooks/use-mock-exam-sort-menu';
import { filterMockExams, sortMockExams } from '@/lib/mock-exams';
import { cn } from '@/lib/utils';

export function MockExamCatalog() {
  const navigation = useServerExams();
  const { exams, sort, filter, sessions, results, setSort, setFilter } = navigation;
  const [detailsExamId, setDetailsExamId] = useState<string>();
  const visibleExams = filterMockExams(sortMockExams(exams, sort, results), filter, results);
  const detailsExam = exams.find((exam) => exam.id === detailsExamId);
  const {
    open: sortOpen,
    rootRef: sortRootRef,
    triggerRef: sortTriggerRef,
    setOpen: setSortOpen,
    onTriggerKeyDown: onSortTriggerKeyDown,
    onMenuKeyDown: onSortMenuKeyDown,
  } = useMockExamSortMenu();
  const {
    open: filterOpen,
    rootRef: filterRootRef,
    triggerRef: filterTriggerRef,
    setOpen: setFilterOpen,
    onTriggerKeyDown: onFilterTriggerKeyDown,
    onMenuKeyDown: onFilterMenuKeyDown,
  } = useMockExamSortMenu();
  const selectedSort = MOCK_EXAM_COPY.sortOptions.find((option) => option.id === sort);
  const selectedFilter = MOCK_EXAM_COPY.filterOptions.find((option) => option.id === filter);

  return (
    <>
      {navigation.failed ? <ErrorNote message={C.loadError} onRetry={navigation.retry} /> : null}
      {navigation.error && !detailsExam ? <ErrorNote message={navigation.error} /> : null}
      {navigation.loading && !navigation.failed ? (
        <p className={layout.typography.description} role="status">
          {C.loading}
        </p>
      ) : null}
      <div className={MOCK_EXAM_LAYOUT.toolbar}>
        <div ref={sortRootRef} className={MOCK_EXAM_LAYOUT.sortRoot}>
          <button
            ref={sortTriggerRef}
            type="button"
            className={MOCK_EXAM_LAYOUT.sortTrigger}
            aria-label={MOCK_EXAM_COPY.sortLabel}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((currentOpen) => !currentOpen)}
            onKeyDown={onSortTriggerKeyDown}
          >
            <span>{selectedSort?.label}</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                MOCK_EXAM_LAYOUT.sortChevron,
                sortOpen && MOCK_EXAM_LAYOUT.sortChevronOpen,
              )}
            />
          </button>
          {sortOpen ? (
            <div
              className={MOCK_EXAM_LAYOUT.sortMenu}
              role="listbox"
              aria-label={MOCK_EXAM_COPY.sortLabel}
              onKeyDown={onSortMenuKeyDown}
            >
              {MOCK_EXAM_COPY.sortOptions.map((option) => {
                const selected = option.id === sort;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={MOCK_EXAM_LAYOUT.sortOption}
                    onClick={() => {
                      setSort(option.id as MockExamSort);
                      setSortOpen(false);
                      sortTriggerRef.current?.focus();
                    }}
                  >
                    {selected ? (
                      <Check aria-hidden="true" className={MOCK_EXAM_LAYOUT.sortCheck} />
                    ) : (
                      <span className={MOCK_EXAM_LAYOUT.sortCheckPlaceholder} />
                    )}
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div ref={filterRootRef} className={MOCK_EXAM_LAYOUT.sortRoot}>
          <button
            ref={filterTriggerRef}
            type="button"
            className={MOCK_EXAM_LAYOUT.filterTrigger}
            aria-label={`${MOCK_EXAM_COPY.filterLabel}: ${selectedFilter?.label}`}
            aria-haspopup="listbox"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((currentOpen) => !currentOpen)}
            onKeyDown={onFilterTriggerKeyDown}
          >
            <ListFilter aria-hidden="true" className={MOCK_EXAM_LAYOUT.filterIcon} />
            <ChevronDown
              aria-hidden="true"
              className={cn(
                MOCK_EXAM_LAYOUT.sortChevron,
                filterOpen && MOCK_EXAM_LAYOUT.sortChevronOpen,
              )}
            />
            {filter !== 'all' ? (
              <span aria-hidden="true" className={MOCK_EXAM_LAYOUT.filterIndicator} />
            ) : null}
          </button>
          {filterOpen ? (
            <div
              className={cn(MOCK_EXAM_LAYOUT.sortMenu, MOCK_EXAM_LAYOUT.filterMenu)}
              role="listbox"
              aria-label={MOCK_EXAM_COPY.filterLabel}
              onKeyDown={onFilterMenuKeyDown}
            >
              {MOCK_EXAM_COPY.filterOptions.map((option) => {
                const selected = option.id === filter;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={MOCK_EXAM_LAYOUT.sortOption}
                    onClick={() => {
                      setFilter(option.id as MockExamFilter);
                      setFilterOpen(false);
                      filterTriggerRef.current?.focus();
                    }}
                  >
                    {selected ? (
                      <Check aria-hidden="true" className={MOCK_EXAM_LAYOUT.sortCheck} />
                    ) : (
                      <span className={MOCK_EXAM_LAYOUT.sortCheckPlaceholder} />
                    )}
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className={MOCK_EXAM_LAYOUT.listFrame} aria-busy={navigation.loading}>
        <div className={cn(layout.scroll, MOCK_EXAM_LAYOUT.list)}>
          {visibleExams.map((exam) => (
            <MockExamCard
              key={exam.id}
              exam={exam}
              result={results[exam.id]}
              session={sessions[exam.id]}
              opening={navigation.openingExamId === exam.id}
              disabled={navigation.pending}
              onOpen={() => {
                if (results[exam.id] || sessions[exam.id]) {
                  setDetailsExamId(exam.id);
                  return;
                }
                navigation.openExam(exam.id);
              }}
            />
          ))}
          {!navigation.loading &&
          !navigation.failed &&
          navigation.data !== null &&
          visibleExams.length === 0 ? (
            <p className={MOCK_EXAM_LAYOUT.emptyFilter}>{MOCK_EXAM_COPY.emptyFilter}</p>
          ) : null}
        </div>
      </div>
      <MockExamDetails
        exam={detailsExam}
        result={detailsExamId ? results[detailsExamId] : undefined}
        inProgress={Boolean(detailsExamId && sessions[detailsExamId])}
        pending={navigation.pending}
        error={navigation.error}
        onClose={() => setDetailsExamId(undefined)}
        onView={() => {
          if (!detailsExam) return;
          navigation.openExam(detailsExam.id);
        }}
        onStartNew={() => {
          if (detailsExam) void navigation.openExam(detailsExam.id, true);
        }}
      />
    </>
  );
}
