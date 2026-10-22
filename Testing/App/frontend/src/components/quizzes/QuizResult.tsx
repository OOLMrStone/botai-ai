import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { QUIZ_COPY } from '@/config/quiz';
import { useQuiz } from '@/hooks/use-quiz';
import { cn } from '@/lib/utils';

export function QuizResult() {
  const { score, questions } = useQuiz();

  return (
    <div className={cn(layout.scroll, layout.quiz.result)}>
      <p className={layout.quiz.score}>
        {score} {QUIZ_COPY.resultOf} {questions.length}
      </p>
      <ScreenHeading
        title={score === questions.length ? QUIZ_COPY.perfectResult : QUIZ_COPY.result}
      />
      <p className={layout.quiz.note}>
        {score === questions.length ? QUIZ_COPY.perfectNote : QUIZ_COPY.resultNote}
      </p>
    </div>
  );
}
