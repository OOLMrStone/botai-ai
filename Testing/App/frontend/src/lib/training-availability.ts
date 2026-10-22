import { CHECK_DISABLED_REASONS, DISABLED_ACTION_COPY as C } from '@/config/disabled-action';
import type { TRAINING_REVIEW_STATES } from '@/config/training-review';
import type { AttemptItem } from '@/lib/api/learning-types';
import { itemLocked } from '@/lib/attempt';

export function checkDisabledReason(
  states: readonly (keyof typeof TRAINING_REVIEW_STATES)[],
  readyCount: number,
  busy: boolean,
  canReviewPhoto = true,
) {
  if (readyCount > 0 || busy) return undefined;
  if (!states.length) return C.checkEmpty;
  const applicableStates = states.map((state) =>
    state === 'photo' && !canReviewPhoto ? 'pro' : state,
  );
  return (
    CHECK_DISABLED_REASONS.find((entry) =>
      entry.states.some((state) => applicableStates.includes(state)),
    )?.reason ?? C.checkFinished
  );
}

export function photoDisabledReason(item: AttemptItem | undefined, busy: boolean) {
  if (!item || busy) return undefined;
  if (itemLocked(item)) return C.photoLocked;
  return item.submission && item.submission.status !== 'draft' ? C.photoRetry : undefined;
}
