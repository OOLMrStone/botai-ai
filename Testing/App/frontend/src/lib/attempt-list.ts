import { ATTEMPT_COPY as C, type AttemptFilter } from '@/config/attempts';
import { LEARNING_COPY, DATE_FORMAT } from '@/config/integration';
import type { Attempt, ExamTemplate } from '@/lib/api/learning-types';

export function attemptTitle(attempt: Attempt, exams: ExamTemplate[] | null) {
  if (attempt.title) return attempt.title;
  if (attempt.kind === 'mock-exam') {
    return exams?.find((exam) => exam.id === attempt.templateId)?.title ?? LEARNING_COPY.examTitle;
  }

  const numbers = [...new Set(attempt.items.map((item) => item.task.examNumber))].join(', ');
  return LEARNING_COPY.trainingTitle(numbers);
}

export function attemptCardContent(attempt: Attempt, exams: ExamTemplate[] | null) {
  const completed = attempt.status === 'completed';
  const checking = attempt.status === 'checking';
  const { answered, total, earnedPoints, maxPoints } = attempt.summary;

  return {
    title: attemptTitle(attempt, exams),
    date: DATE_FORMAT.format(new Date(attempt.lastExitedAt ?? attempt.createdAt)),
    kind: attempt.kind === 'mock-exam' ? C.exam : C.training,
    summary: completed
      ? C.completed(earnedPoints, maxPoints)
      : checking
        ? C.checking
        : answered
          ? C.progress(answered, total)
          : C.notStarted(total),
    action: completed ? C.result : checking ? C.checkProgress : C.continue,
    completed,
  };
}

export function filterAttempts(attempts: Attempt[] | null, filter: AttemptFilter) {
  return (
    attempts?.filter((attempt) => {
      if (filter === 'all') return true;
      return (attempt.status === 'completed') === (filter === 'completed');
    }) ?? null
  );
}

export function recentAttempts(attempts: Attempt[] | null) {
  return attempts
    ? [...attempts].sort(
        (a, b) =>
          Date.parse(b.lastExitedAt ?? b.createdAt) - Date.parse(a.lastExitedAt ?? a.createdAt) ||
          b.id.localeCompare(a.id),
      )
    : null;
}

export function countFittingAttempts(height: number, cardHeights: number[], gap: number) {
  let used = 0;
  let count = 0;
  for (const cardHeight of cardHeights) {
    const next = used + cardHeight + (count ? gap : 0);
    if (cardHeight <= 0 || next > height) break;
    used = next;
    count++;
  }
  return count;
}

export function attemptEmptyContent(history: boolean, filter: AttemptFilter) {
  if (!history) return { title: C.emptyTitle, description: C.emptyDescription };
  if (filter === 'unfinished') {
    return { title: C.emptyUnfinishedTitle, description: C.emptyUnfinishedDescription };
  }
  if (filter === 'completed') {
    return { title: C.emptyCompletedTitle, description: C.emptyCompletedDescription };
  }
  return { title: C.emptyHistoryTitle, description: C.emptyHistoryDescription };
}
