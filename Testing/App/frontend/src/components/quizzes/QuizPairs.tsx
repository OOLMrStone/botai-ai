import { QuizMath } from '@/components/quizzes/QuizMath';
import { layout } from '@/config/layout';
import { type QuizPair } from '@/config/quiz-content';
import { type QuizPairSide } from '@/config/quiz-engine';
import { useQuiz } from '@/hooks/use-quiz';
import { useQuizPairFeedback } from '@/hooks/use-quiz-pair-feedback';
import { quizFeedbackMotion } from '@/lib/quiz-feedback';
import { cn } from '@/lib/utils';

interface QuizPairColumnProps {
  pairs: QuizPair[];
  side: QuizPairSide;
}

function QuizPairColumn({ pairs, side }: QuizPairColumnProps) {
  const { matchedIds, selectPair, feedback, pairTone } = useQuiz();

  return (
    <div className={layout.quiz.pairColumn}>
      {pairs.map((pair) => {
        const tone = pairTone(side, pair.id);

        return (
          <button
            key={pair.id}
            aria-label={pair[side]}
            aria-pressed={tone === 'selected' || tone === 'matched'}
            disabled={!!feedback || matchedIds.includes(pair.id)}
            onClick={() => selectPair(side, pair.id)}
            className={cn(
              layout.quiz.pair,
              layout.focusRing,
              layout.quiz[tone],
              quizFeedbackMotion(tone),
            )}
          >
            <QuizMath value={pair[side]} />
          </button>
        );
      })}
    </div>
  );
}

export function QuizPairs() {
  const { question, rightPairs, pairError } = useQuiz();
  useQuizPairFeedback(pairError);
  if (question?.kind !== 'pairs') return null;

  return (
    <div className={layout.quiz.grid}>
      <QuizPairColumn pairs={question.pairs} side="left" />
      <QuizPairColumn pairs={rightPairs} side="right" />
    </div>
  );
}
