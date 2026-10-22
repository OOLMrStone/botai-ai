import { Check, Flag, X } from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { MathFormula } from '@/components/common/MathFormula';
import { SolutionFormattingNote } from '@/components/experimental/SolutionFormattingNote';
import { Button } from '@/components/ui/button';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { EXPERIMENTAL_COPY, type ExperimentalPoint } from '@/config/experimental';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface SolutionPointDetailProps {
  point: ExperimentalPoint;
  disputed: boolean;
  onDispute: () => void;
}

export function SolutionPointDetail({ point, disputed, onDispute }: SolutionPointDetailProps) {
  const styles = layout.experimentalSolution;
  const copy = EXPERIMENTAL_COPY.solution;

  return (
    <div>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeading}>
          <p className={styles.detailEyebrow}>
            <span className={cn(styles.detailDot, styles.tones[point.status].marker)} />
            {copy[point.status]}
          </p>
          <ScreenHeading title={point.title} as="h3" variant="task" />
        </div>
        <Popover.Close
          render={<Button variant="ghost" size="icon-compact" aria-label={copy.closeComment} />}
        >
          <X aria-hidden="true" />
        </Popover.Close>
      </div>
      <div className={styles.detailBody}>
        <p className={styles.detailText}>{point.explanation}</p>
        {point.math ? <MathFormula value={point.math} className={styles.detailMath} /> : null}
        {point.detail ? <p className={styles.detailSecondary}>{point.detail}</p> : null}
        {point.formattingNote ? <SolutionFormattingNote point={point} /> : null}
      </div>
      <div className={styles.detailActions}>
        <Button variant="ghost" size="compact" className={styles.dispute} onClick={onDispute}>
          {disputed ? <Check aria-hidden="true" /> : <Flag aria-hidden="true" />}
          {disputed ? copy.undispute : copy.dispute}
        </Button>
        {disputed ? <span className={styles.disputed}>{copy.disputed}</span> : null}
      </div>
    </div>
  );
}
