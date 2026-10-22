import type { MockExam, MockExamFilter, MockExamSort } from '@/config/mock-exams';
import type { MockExamResult, MockExamSession } from '@/stores/mock-exams-store';

export function sortMockExams(
  exams: MockExam[],
  sort: MockExamSort,
  results: Record<string, MockExamResult>,
) {
  return [...exams].sort((left, right) => {
    if (sort === 'oldest') return left.date.localeCompare(right.date);
    if (sort === 'score') {
      const resultOrder =
        Number(Boolean(results[right.id]?.completedAt)) -
        Number(Boolean(results[left.id]?.completedAt));
      if (resultOrder !== 0) return resultOrder;
    }
    return right.date.localeCompare(left.date);
  });
}

export function filterMockExams(
  exams: MockExam[],
  filter: MockExamFilter,
  results: Record<string, MockExamResult>,
) {
  if (filter === 'all') return exams;
  const solved = filter === 'solved';
  return exams.filter((exam) => Boolean(results[exam.id]) === solved);
}

export function mockExamScore(correctAnswers: number, totalTasks: number) {
  if (totalTasks === 0) return 0;
  return Math.round((correctAnswers / totalTasks) * 100);
}

export function createMockExamSession(examId: string): MockExamSession {
  return { examId, currentIndex: 0, answers: {}, attachments: {}, statuses: {} };
}
