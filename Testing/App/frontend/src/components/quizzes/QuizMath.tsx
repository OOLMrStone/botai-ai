import { MathFormula } from '@/components/common/MathFormula';
import { layout } from '@/config/layout';
import { useQuizFormulaFit } from '@/hooks/use-quiz-formula-fit';

export function QuizMath({ value }: { value: string }) {
  const { containerRef, formulaRef } = useQuizFormulaFit(value);

  return (
    <div ref={containerRef} className={layout.quiz.mathFit}>
      <div ref={formulaRef} className={layout.quiz.mathInner}>
        <MathFormula displayMode value={value} />
      </div>
    </div>
  );
}
