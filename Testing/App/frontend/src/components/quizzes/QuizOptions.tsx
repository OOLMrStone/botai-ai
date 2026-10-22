import { QuizMath } from '@/components/quizzes/QuizMath';
import { QuizBuild } from '@/components/quizzes/QuizBuild';
import { layout } from '@/config/layout';
import { useQuiz } from '@/hooks/use-quiz';
import { quizFeedbackMotion } from '@/lib/quiz-feedback';
import { cn } from '@/lib/utils';

export function QuizOptions() {
  const { question, selectedIds, optionTone, choose, feedback } = useQuiz();
  if (!question || question.kind === 'pairs') return null;
  if (question.kind === 'build') return <QuizBuild key={question.id} />;

  return (
    <div className={layout.quiz.stack}>
      <div className={layout.quiz.answers}>
        {question.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          const tone = optionTone(option.id);

          return (
            <button
              key={option.id}
              aria-label={option.latex}
              aria-pressed={selected}
              disabled={!!feedback}
              onClick={() => choose(option.id)}
              className={cn(
                layout.quiz.answer,
                layout.focusRing,
                layout.quiz[tone],
                quizFeedbackMotion(tone, selected),
              )}
            >
              <QuizMath value={option.latex} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
