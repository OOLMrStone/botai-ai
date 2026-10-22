import { useEffect, useRef } from 'react';

export function useQuizFeedback(feedback: string | null) {
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedback) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [feedback]);

  return feedbackRef;
}
