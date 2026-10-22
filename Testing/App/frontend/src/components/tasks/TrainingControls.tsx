import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';

import { AnswerInput } from '@/components/tasks/AnswerInput';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { TASK_ANSWER_INPUT_ID, TASK_COPY, type TaskStatus } from '@/config/tasks';
import type { TrainingSession } from '@/stores/tasks-store';
import { TRAINING_REVIEW_COPY } from '@/config/training-review';

interface TrainingControlsProps {
  session: TrainingSession;
  busy?: boolean;
  checkDisabledReason?: string;
  editingBusy?: boolean;
  locked?: boolean;
  taskId: string | undefined;
  taskCount: number;
  review: boolean;
  reviewIndex: number;
  status: TaskStatus;
  unverified: boolean;
  allCorrect: boolean;
  onSelect: (index: number) => void;
  onAnswer: (taskId: string, answer: string) => void;
  onCheck: () => void;
  onContinue: () => void;
}

export function TrainingControls({
  session,
  busy = false,
  checkDisabledReason,
  editingBusy = false,
  locked = false,
  taskId,
  taskCount,
  review,
  reviewIndex,
  status,
  unverified,
  allCorrect,
  onSelect,
  onAnswer,
  onCheck,
  onContinue,
}: TrainingControlsProps) {
  if (review) {
    return (
      <div className={layout.training.reviewActions}>
        {!allCorrect ? (
          <Button
            className={layout.training.reviewAction}
            disabled={!unverified || busy}
            disabledReason={checkDisabledReason}
            onClick={onCheck}
          >
            {TRAINING_REVIEW_COPY.check}
          </Button>
        ) : null}
        <Button
          className={layout.training.reviewAction}
          variant={allCorrect ? 'default' : 'outline'}
          disabled={busy}
          onClick={onContinue}
        >
          {allCorrect ? TRAINING_REVIEW_COPY.done : TRAINING_REVIEW_COPY.exit}
        </Button>
      </div>
    );
  }

  if (!taskId) return null;

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className={layout.training.controlButton}
        aria-label={TASK_COPY.training.previous}
        disabled={session.currentIndex === 0 || busy}
        onClick={() => onSelect(session.currentIndex - 1)}
      >
        <ChevronLeft />
      </Button>
      <AnswerInput
        id={TASK_ANSWER_INPUT_ID}
        answerKey={taskId}
        disabled={editingBusy}
        readOnly={locked}
        value={session.answers[taskId] ?? ''}
        validationState={
          status === 'correct' ? 'success' : status === 'incorrect' ? 'error' : 'neutral'
        }
        placeholder={TASK_COPY.training.answer}
        onValueChange={(answer) => onAnswer(taskId, answer)}
      />
      {session.currentIndex === taskCount - 1 ? (
        <Button
          variant="outline"
          size="icon"
          className={layout.training.controlButton}
          aria-label={TASK_COPY.training.toReview}
          disabled={busy}
          onClick={() => onSelect(reviewIndex)}
        >
          <CheckCheck />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className={layout.training.controlButton}
          aria-label={TASK_COPY.training.next}
          disabled={busy}
          onClick={() => onSelect(session.currentIndex + 1)}
        >
          <ChevronRight />
        </Button>
      )}
    </>
  );
}
