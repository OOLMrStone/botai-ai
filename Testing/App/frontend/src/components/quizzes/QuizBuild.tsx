import { MathFormula } from '@/components/common/MathFormula';
import { layout } from '@/config/layout';
import type { QuizOption } from '@/config/quiz-content';
import type { QuizAnswerTone } from '@/config/quiz-engine';
import { useQuiz } from '@/hooks/use-quiz';
import { useQuizTokenMotion } from '@/hooks/use-quiz-token-motion';
import { quizFeedbackMotion } from '@/lib/quiz-feedback';
import { cn } from '@/lib/utils';

function BuildToken({
  option,
  tone,
  disabled,
  onChoose,
}: {
  option: QuizOption;
  tone: QuizAnswerTone;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-quiz-token={option.id}
      aria-label={option.latex}
      disabled={disabled}
      onClick={() => onChoose(option.id)}
      className={cn(
        layout.quiz.token,
        layout.quiz.tokenMoving,
        layout.quiz[tone],
        layout.focusRing,
      )}
    >
      <MathFormula displayMode value={option.latex} />
    </button>
  );
}

export function QuizBuild() {
  const { question, selectedIds, selectedOptions, selectedTone, choose, feedback } = useQuiz();
  const { containerRef, moveToken } = useQuizTokenMotion();
  if (question?.kind !== 'build') return null;

  const onChoose = (id: string) => moveToken(() => choose(id));

  return (
    <div ref={containerRef} className={layout.quiz.stack}>
      <div className={cn(layout.quiz.buildZone, quizFeedbackMotion(selectedTone))}>
        {selectedOptions.map((option) => (
          <BuildToken
            key={option.id}
            option={option}
            tone={selectedTone}
            disabled={!!feedback}
            onChoose={onChoose}
          />
        ))}
      </div>
      <div className={layout.quiz.tokens}>
        {question.options.map((option) =>
          selectedIds.includes(option.id) ? (
            <div
              key={option.id}
              aria-hidden="true"
              className={cn(layout.quiz.token, layout.quiz.tokenPlaceholder)}
            >
              <MathFormula
                displayMode
                value={option.latex}
                className={layout.quiz.tokenPlaceholderContent}
              />
            </div>
          ) : (
            <BuildToken
              key={option.id}
              option={option}
              tone="idle"
              disabled={!!feedback}
              onChoose={onChoose}
            />
          ),
        )}
      </div>
    </div>
  );
}
