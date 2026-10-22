import { DialogSheet } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/common/ErrorNote';
import { MOCK_EXAM_COPY, MOCK_EXAM_LAYOUT, type MockExam } from '@/config/mock-exams';
import { cn } from '@/lib/utils';
import type { MockExamResult } from '@/stores/mock-exams-store';

interface MockExamDetailsProps {
  exam: MockExam | undefined;
  result: MockExamResult | undefined;
  inProgress: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onView: () => void;
  onStartNew: () => void;
}

export function MockExamDetails({
  exam,
  result,
  inProgress,
  pending,
  error,
  onClose,
  onView,
  onStartNew,
}: MockExamDetailsProps) {
  if (!exam) return null;

  return (
    <DialogSheet
      open
      title={exam.title}
      closeLabel={MOCK_EXAM_COPY.detailsClose}
      className={MOCK_EXAM_LAYOUT.details}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className={MOCK_EXAM_LAYOUT.detailsGrid}>
        {result ? (
          <div className={MOCK_EXAM_LAYOUT.detailsMetric}>
            <p className={MOCK_EXAM_LAYOUT.detailsLabel}>{MOCK_EXAM_COPY.detailsResult}</p>
            <p className={MOCK_EXAM_LAYOUT.detailsValue}>{MOCK_EXAM_COPY.score(result.score)}</p>
          </div>
        ) : null}
        <div className={MOCK_EXAM_LAYOUT.detailsMetric}>
          <p className={MOCK_EXAM_LAYOUT.detailsLabel}>{MOCK_EXAM_COPY.detailsDate}</p>
          <p className={MOCK_EXAM_LAYOUT.detailsValue}>{exam.dateLabel}</p>
        </div>
        <div
          className={cn(
            MOCK_EXAM_LAYOUT.detailsMetric,
            result && MOCK_EXAM_LAYOUT.detailsTaskMetric,
          )}
        >
          <p className={MOCK_EXAM_LAYOUT.detailsLabel}>{MOCK_EXAM_COPY.detailsTasks}</p>
          <p className={MOCK_EXAM_LAYOUT.detailsValue}>{exam.tasks.length}</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      <div className={MOCK_EXAM_LAYOUT.detailsActions} aria-busy={pending}>
        <Button className={MOCK_EXAM_LAYOUT.detailsAction} onClick={onView} disabled={pending}>
          {pending
            ? MOCK_EXAM_COPY.opening
            : inProgress
              ? MOCK_EXAM_COPY.continue
              : MOCK_EXAM_COPY.view}
        </Button>
        <Button
          className={MOCK_EXAM_LAYOUT.detailsAction}
          variant="outline"
          onClick={onStartNew}
          disabled={pending}
        >
          {MOCK_EXAM_COPY.newAttempt}
        </Button>
        <p className={MOCK_EXAM_LAYOUT.detailsLabel}>{MOCK_EXAM_COPY.previousAttempts}</p>
      </div>
    </DialogSheet>
  );
}
