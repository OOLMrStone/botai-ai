import { CheckCircle2, Lightbulb } from 'lucide-react';

import { MathFormula } from '@/components/common/MathFormula';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { QuizAnswers } from '@/components/quizzes/QuizAnswers';
import { layout } from '@/config/layout';
import { QUIZ_COPY } from '@/config/quiz';
import { useQuiz } from '@/hooks/use-quiz';
import { useQuizFeedback } from '@/hooks/use-quiz-feedback';
import { cn } from '@/lib/utils';

export function QuizQuestion() {
  const { question, feedback, correctAnswer } = useQuiz();
  const feedbackRef = useQuizFeedback(feedback);
  if (!question) return null;
  const correct = feedback === 'correct';
  const Icon = correct ? CheckCircle2 : Lightbulb;

  return (
    <div className={cn(layout.scroll, layout.quiz.question)}>
      <ScreenHeading variant="task" title={question.prompt} subtitle={question.context} />
      <QuizAnswers />
      {feedback && (
        <div
          ref={feedbackRef}
          role="status"
          className={cn(
            layout.quiz.feedback,
            correct ? layout.quiz.matched : layout.quiz.incorrect,
          )}
        >
          <div className={layout.quiz.row}>
            <Icon className={layout.quiz.icon} />
            <p className={layout.quiz.label}>{correct ? QUIZ_COPY.correct : QUIZ_COPY.incorrect}</p>
          </div>
          {!correct && question.kind !== 'pairs' && (
            <>
              <p className={layout.quiz.caption}>{QUIZ_COPY.correctAnswer}</p>
              <MathFormula displayMode value={correctAnswer} className={layout.quiz.formula} />
            </>
          )}
          <p className={layout.quiz.body}>{question.explanation}</p>
        </div>
      )}
    </div>
  );
}
