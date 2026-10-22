'use client';

import { useEffect } from 'react';

import { EXPERIMENTAL, EXPERIMENTAL_COPY } from '@/config/experimental';
import { useExperimentalPointReveal } from '@/hooks/use-experimental-point-reveal';
import { normalizeExperimentalScore } from '@/lib/experimental-review';
import { useExperimentalStore } from '@/stores/experimental-store';

export function useExperimentalReview() {
  const review = useExperimentalStore();
  const { feedback, clearFeedback } = review;

  useExperimentalPointReveal();

  useEffect(() => {
    if (!feedback) return;

    const timer = window.setTimeout(clearFeedback, EXPERIMENTAL.feedbackMs);
    return () => window.clearTimeout(timer);
  }, [feedback, clearFeedback]);

  const openStudent = (id: string) => {
    if (id === EXPERIMENTAL.studentId) review.openStudent();
  };

  const setEditorOpen = (open: boolean) => {
    if (!open) review.closeEditor();
  };

  return {
    ...review,
    photoUrl: EXPERIMENTAL.sourceImage,
    hasExpertVerdict:
      review.score !== EXPERIMENTAL.score || review.verdict !== EXPERIMENTAL_COPY.verdict,
    canSaveEdit: Boolean(review.draftText.trim()),
    openStudent,
    setEditorOpen,
    setDraftScore: (score: number) => review.setDraftScore(normalizeExperimentalScore(score)),
  };
}
