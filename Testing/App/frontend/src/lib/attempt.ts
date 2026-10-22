import type { TaskStatus } from '@/config/tasks';
import type { AttemptItem } from '@/lib/api/learning-types';
import { submissionDocumentsProcessing, submissionPagesReady } from '@/lib/solution-validation';
import { isValidShortAnswer } from '@/lib/validation';
import type { TRAINING_REVIEW_STATES } from '@/config/training-review';
export function itemLocked(item: AttemptItem) {
  return Boolean(
    item.result?.isGraded ||
    ['queued', 'running', 'graded'].includes(item.submission?.status ?? ''),
  );
}
export function itemStatus(item: AttemptItem): TaskStatus {
  const result = item.result ?? item.submission?.result;
  if (!result?.isGraded || result.score === null) return 'unverified';
  if (result.score === result.maxScore) return 'correct';
  return result.score === 0 ? 'incorrect' : 'partial';
}
export function itemAnswered(item: AttemptItem) {
  return item.task.responseType === 'short'
    ? isValidShortAnswer(item.answer)
    : Boolean(item.submission?.images.length);
}

export function itemReadyToCheck(item: AttemptItem, canReviewPhoto: boolean) {
  if (itemLocked(item) || !itemAnswered(item)) return false;
  return (
    item.task.responseType === 'short' ||
    (canReviewPhoto &&
      item.task.gradingCapability === 'available' &&
      item.submission?.status === 'draft' &&
      submissionPagesReady(item.submission))
  );
}

export function itemReviewState(
  item: AttemptItem,
  canReviewPhoto: boolean,
): keyof typeof TRAINING_REVIEW_STATES {
  const status = itemStatus(item);
  if (status !== 'unverified') return status;
  const submissionStatus = item.submission?.status;
  if (submissionDocumentsProcessing(item.submission)) return 'document_processing';
  if (item.submission?.documents?.some((document) => document.state === 'failed')) return 'failed';
  if (submissionStatus === 'queued' || submissionStatus === 'running') return 'pending';
  if (item.task.responseType === 'short') {
    if (itemAnswered(item)) return 'ready';
    return item.answer ? 'invalid' : 'empty';
  }
  if (item.task.gradingCapability === 'unsupported' || submissionStatus === 'unsupported')
    return 'unsupported';
  if (item.task.gradingCapability === 'unavailable') return 'unavailable';
  if (submissionStatus && submissionStatus !== 'draft' && submissionStatus !== 'graded')
    return submissionStatus;
  if (!canReviewPhoto && itemAnswered(item)) return 'pro';
  return itemReadyToCheck(item, canReviewPhoto) ? 'ready' : 'photo';
}
