import { ChevronRight } from 'lucide-react';
import { MOCK_EXAM_COPY, MOCK_EXAM_LAYOUT, type MockExam } from '@/config/mock-exams';
import type { MockExamResult, MockExamSession } from '@/stores/mock-exams-store';

interface MockExamCardProps {
  exam: MockExam;
  result: MockExamResult | undefined;
  session: MockExamSession | undefined;
  onOpen: () => void;
  opening?: boolean;
  disabled?: boolean;
}

export function MockExamCard({
  exam,
  result,
  session,
  onOpen,
  opening = false,
  disabled = false,
}: MockExamCardProps) {
  const inProgress = Boolean(session) && !result;
  const status = result
    ? MOCK_EXAM_COPY.solved
    : inProgress
      ? MOCK_EXAM_COPY.inProgress
      : MOCK_EXAM_COPY.notStarted;
  const action = opening
    ? MOCK_EXAM_COPY.opening
    : result || inProgress
      ? MOCK_EXAM_COPY.details
      : MOCK_EXAM_COPY.solve;

  return (
    <button
      type="button"
      className={MOCK_EXAM_LAYOUT.card}
      onClick={onOpen}
      disabled={disabled}
      aria-busy={opening}
    >
      <div className={MOCK_EXAM_LAYOUT.cardMeta}>
        <span>{exam.dateLabel}</span>
        <span className={MOCK_EXAM_LAYOUT.cardStatus}>{status}</span>
      </div>
      <div className={MOCK_EXAM_LAYOUT.cardBody}>
        <div className="min-w-0">
          <h2 className={MOCK_EXAM_LAYOUT.cardTitle}>{exam.title}</h2>
          <p className={MOCK_EXAM_LAYOUT.cardResult}>
            {result
              ? MOCK_EXAM_COPY.score(result.score)
              : MOCK_EXAM_COPY.taskCount(exam.tasks.length)}
          </p>
          <p className={MOCK_EXAM_LAYOUT.cardHint} aria-live="polite">
            {action}
          </p>
        </div>
        <ChevronRight aria-hidden="true" className={MOCK_EXAM_LAYOUT.cardChevron} />
      </div>
    </button>
  );
}
