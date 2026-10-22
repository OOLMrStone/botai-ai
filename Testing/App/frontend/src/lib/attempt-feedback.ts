import { ATTEMPT_FEEDBACK_COPY, CANCELLABLE_SUBMISSION_STATES } from '@/config/attempt-feedback';
import { LEARNING_COPY } from '@/config/integration';
import { TRAINING_REVIEW_COPY, TRAINING_REVIEW_STATES } from '@/config/training-review';
import type { AttemptItem, GradeResult } from '@/lib/api/learning-types';
import { itemReviewState, itemStatus } from '@/lib/attempt';

function feedbackDetails(result: GradeResult | null | undefined) {
  const feedback = result?.feedback;
  const paragraphs = [
    ...new Set(
      [result?.rejectionReason, feedback?.analysis.summary, feedback?.grading.explanation]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const errors = (feedback?.analysis.errors ?? [])
    .map((error) => ({
      id: error.id,
      description: error.description.trim(),
      where: error.where?.trim(),
      correction: error.correctVersion?.trim(),
      advice: error.advice?.trim(),
    }))
    .filter((error) => error.description || error.where || error.correction || error.advice);

  return { paragraphs, errors, hasDetails: paragraphs.length > 0 || errors.length > 0 };
}

export function attemptFeedback(item: AttemptItem, canReviewPhoto: boolean) {
  const submission = item.submission;
  const result = item.result ?? submission?.result;
  if (!result && (!submission || (submission.status === 'draft' && !submission.images.length))) {
    return null;
  }

  const state = itemStatus(item);
  const reviewState = itemReviewState(item, canReviewPhoto);
  const visual = TRAINING_REVIEW_STATES[reviewState];
  let label: string = submission ? LEARNING_COPY.status[submission.status] : LEARNING_COPY.noScore;
  if (submission?.status === 'draft') {
    label =
      item.task.gradingCapability === 'available'
        ? canReviewPhoto
          ? ATTEMPT_FEEDBACK_COPY.photoReady
          : TRAINING_REVIEW_COPY.photoSavedPro
        : ATTEMPT_FEEDBACK_COPY.photoSaved;
  }
  if (result?.isGraded && result.score !== null) {
    label =
      item.task.responseType === 'short'
        ? state === 'correct'
          ? ATTEMPT_FEEDBACK_COPY.correct
          : ATTEMPT_FEEDBACK_COPY.incorrect
        : ATTEMPT_FEEDBACK_COPY.photoScore(result.score, result.maxScore);
  }

  return {
    label,
    icon: visual.icon,
    tone: visual.className,
    isDemo: Boolean(result?.isDemo),
    ...feedbackDetails(result),
    canCancel: CANCELLABLE_SUBMISSION_STATES.some((status) => status === submission?.status),
    cancelLabel: LEARNING_COPY.cancel,
    canRetry: Boolean(submission?.retryable),
    retryLabel: canReviewPhoto ? LEARNING_COPY.retryCheck : ATTEMPT_FEEDBACK_COPY.retryPhoto,
  };
}

export type AttemptFeedbackView = NonNullable<ReturnType<typeof attemptFeedback>>;
