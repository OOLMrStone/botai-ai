import { Lightbulb } from 'lucide-react';
import { MathFormula } from '@/components/common/MathFormula';
import { EXPERIMENTAL_COPY, type ExperimentalPoint } from '@/config/experimental';
import { layout } from '@/config/layout';

export function SolutionFormattingNote({ point }: { point: ExperimentalPoint }) {
  const styles = layout.experimentalSolution;
  const copy = EXPERIMENTAL_COPY.solution;

  return (
    <div className={styles.formatNote}>
      <Lightbulb className={styles.formatIcon} aria-hidden="true" />
      <div className={styles.formatBody}>
        <p className={styles.formatTitle}>{copy.formatting}</p>
        <p className={styles.detailText}>{point.formattingNote}</p>
        {point.formattingFormula ? (
          <MathFormula value={point.formattingFormula} className={styles.formatFormula} />
        ) : null}
        <p className={styles.noPenalty}>{copy.noPenalty}</p>
      </div>
    </div>
  );
}
