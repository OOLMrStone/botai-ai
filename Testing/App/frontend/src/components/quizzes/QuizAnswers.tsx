import { useRef } from 'react';

import { QuizOptions } from '@/components/quizzes/QuizOptions';
import { QuizPairs } from '@/components/quizzes/QuizPairs';
import { layout } from '@/config/layout';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { useQuiz } from '@/hooks/use-quiz';

export function QuizAnswers() {
  const ref = useRef<HTMLDivElement>(null);
  const question = useQuiz().question;
  useGestureSurfaceGuard(ref);

  return (
    <div
      ref={ref}
      className={layout.gestureSurface}
      onContextMenu={(event) => event.preventDefault()}
    >
      {question?.kind === 'pairs' ? <QuizPairs /> : <QuizOptions />}
    </div>
  );
}
