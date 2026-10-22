'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { checkDisabledReason, photoDisabledReason } from '@/lib/training-availability';
import { usePaywall } from '@/hooks/use-paywall';
import { useAttemptActivity } from '@/hooks/use-attempt-activity';
import { useAttemptExit } from '@/hooks/use-attempt-exit';
import { useAttempt } from '@/hooks/use-attempt';
import { useKeyboardViewport } from '@/hooks/use-keyboard-viewport';
import { useTaskKeyboardNavigation } from '@/hooks/use-task-keyboard-navigation';
import { ROUTES } from '@/config/onboarding-steps';
import {
  itemAnswered,
  itemLocked,
  itemReadyToCheck,
  itemReviewState,
  itemStatus,
} from '@/lib/attempt';
import { TRAINING_REVIEW_ATTENTION_STATES, TRAINING_REVIEW_COPY } from '@/config/training-review';
import { fetchSolution, revealSolution } from '@/lib/api/learning';
import type { Solution } from '@/lib/api/learning-types';
import { solutionInputKey } from '@/lib/task-content';
import { LEARNING_COPY as C } from '@/config/integration';
import { ATTEMPT_COPY } from '@/config/attempts';
export function useTrainingShell(id: string) {
  const router = useRouter();
  const training = useAttempt(id);
  const paywall = usePaywall();
  const attempt = training.attempt;
  const attemptExit = useAttemptExit(id, Boolean(attempt));
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [cachedSolutions, setSolutions] = useState<
    Record<string, { value: Solution; inputKey: string }>
  >({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const activity = useAttemptActivity(
    id,
    Boolean(attempt && attempt.status !== 'completed' && !paywall.visible),
  );
  const currentIndex = attempt?.currentIndex ?? 0;
  const reviewIndex = attempt?.items.length ?? 0;
  useKeyboardViewport();
  useTaskKeyboardNavigation({
    currentIndex,
    lastIndex: reviewIndex,
    enabled: Boolean(attempt) && !training.busy && !exitBusy,
    onSelect: (index) => {
      void training.select(index);
    },
  });
  const item = attempt?.items[currentIndex];
  const statuses = Object.fromEntries(
    (attempt?.items ?? []).map((item) => [item.id, itemStatus(item)]),
  );
  const currentItems = (attempt?.items ?? []).map((item) => ({
    ...item,
    answer: training.answers[item.id] ?? item.answer,
  }));
  const answeredTaskIds = currentItems.filter(itemAnswered).map((item) => item.id);
  const readyCount = currentItems.filter((item) =>
    itemReadyToCheck(item, training.canReviewPhoto),
  ).length;
  const completed = attempt?.status === 'completed';
  const reviewItems = currentItems.map((item, index) => ({
    id: item.id,
    index,
    examNumber: item.task.examNumber,
    state: itemReviewState(item, training.canReviewPhoto),
  }));
  const needsPro = reviewItems.some(({ state }) => state === 'pro');
  const reviewDescription = completed
    ? TRAINING_REVIEW_COPY.finished
    : readyCount
      ? needsPro
        ? TRAINING_REVIEW_COPY.readyWithProPhotos
        : TRAINING_REVIEW_COPY.ready
      : needsPro
        ? TRAINING_REVIEW_COPY.photoSavedPro
        : reviewItems.some(({ state }) => state === 'pending' || state === 'document_processing')
          ? TRAINING_REVIEW_COPY.pending
          : reviewItems.some(({ state }) => TRAINING_REVIEW_ATTENTION_STATES.includes(state))
            ? TRAINING_REVIEW_COPY.attention
            : attempt?.summary.graded
              ? TRAINING_REVIEW_COPY.continue
              : TRAINING_REVIEW_COPY.empty;
  const photoNotice =
    item?.task.responseType !== 'photo'
      ? null
      : item.task.gradingCapability === 'unsupported'
        ? C.unsupported
        : item.task.gradingCapability === 'unavailable'
          ? C.gradingUnavailable
          : !training.canReviewPhoto && !itemLocked(item) && !itemAnswered(item)
            ? TRAINING_REVIEW_COPY.photoProNotice
            : null;
  const solutions = Object.fromEntries(
    (attempt?.items ?? []).flatMap((item) => {
      const cached = cachedSolutions[item.id];
      return !training.unsaved && !training.busy && cached?.inputKey === solutionInputKey(item)
        ? [[item.id, cached.value]]
        : [];
    }),
  );
  const visibleRevealed = revealed.filter((id) => Boolean(solutions[id]));
  const toggleSolution = async (itemId: string) => {
    if (!attempt) return;
    setRevealError(null);
    if (visibleRevealed.includes(itemId)) {
      setRevealed((items) => items.filter((id) => id !== itemId));
      return;
    }
    setRevealBusy(true);
    try {
      const saved = await training.save();
      const item = saved?.items.find((item) => item.id === itemId);
      if (!saved || !item) return;
      const unsupported = item.task.part === 2 && item.task.gradingCapability === 'unsupported';
      const solution = unsupported
        ? await revealSolution(
            saved.id,
            itemId,
            item.answerRevision,
            item.submission?.id ?? null,
            item.submission?.revision ?? null,
          )
        : await fetchSolution(saved.id, itemId);
      setSolutions((current) => ({
        ...current,
        [itemId]: { value: solution, inputKey: solutionInputKey(item) },
      }));
      setRevealed((items) => [...items.filter((id) => id !== itemId), itemId]);
    } catch (cause) {
      setRevealError(cause instanceof Error ? cause.message : C.loadError);
    } finally {
      setRevealBusy(false);
    }
  };
  const exit = async () => {
    if (exitBusy) return;
    setExitBusy(true);
    setExitError(null);
    try {
      const saved = await training.save();
      if (!saved) return;
      await attemptExit.recordExit();
      await activity.pause();
      router.push(ROUTES.home);
    } catch (cause) {
      setExitError(cause instanceof Error ? cause.message : ATTEMPT_COPY.exitError);
    } finally {
      setExitBusy(false);
    }
  };
  return {
    ...training,
    error: exitError ?? training.error,
    exitError,
    activity,
    requestPhotoAccess: training.canReviewPhoto ? undefined : () => paywall.open('photo'),
    item,
    currentIndex,
    reviewIndex,
    review: currentIndex === reviewIndex,
    statuses,
    answeredTaskIds,
    readyCount,
    checkDisabledReason: checkDisabledReason(
      reviewItems.map(({ state }) => state),
      readyCount,
      training.busy || revealBusy || exitBusy,
      training.canReviewPhoto,
    ),
    photoDisabledReason: photoDisabledReason(item, training.busy || revealBusy || exitBusy),
    needsPro,
    photoNotice,
    completed,
    reviewDescription,
    reviewItems,
    solutions,
    revealed: visibleRevealed,
    busy: training.busy || revealBusy || exitBusy,
    editingBusy: training.editingBusy || revealBusy || exitBusy,
    revealBusy,
    revealError,
    toggleSolution,
    exit,
  };
}
