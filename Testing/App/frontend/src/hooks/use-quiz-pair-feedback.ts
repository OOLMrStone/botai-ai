'use client';

import { useEffect } from 'react';

import { QUIZ_ENGINE, type QuizPairError } from '@/config/quiz-engine';
import { useQuizStore } from '@/stores/quiz-store';

export function useQuizPairFeedback(error: QuizPairError | null) {
  const clearPairError = useQuizStore((state) => state.clearPairError);

  useEffect(() => {
    if (!error) return;

    const timeout = window.setTimeout(() => clearPairError(error), QUIZ_ENGINE.pairErrorMs);

    return () => window.clearTimeout(timeout);
  }, [error, clearPairError]);
}
