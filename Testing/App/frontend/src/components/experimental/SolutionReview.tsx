import type { ReactNode } from 'react';
import { ScanLine } from 'lucide-react';
import { MathFormula } from '@/components/common/MathFormula';
import { SolutionStep } from '@/components/experimental/SolutionStep';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import {
  EXPERIMENTAL_COPY,
  EXPERIMENTAL_SOLUTION,
  type ExperimentalPointId,
} from '@/config/experimental';
import { layout } from '@/config/layout';

interface SolutionReviewProps {
  selectedId: ExperimentalPointId | null;
  onPointOpen: (id: ExperimentalPointId, open: boolean) => void;
  onDispute: (id: ExperimentalPointId) => void;
  disputedIds: ExperimentalPointId[];
  sourceAction?: ReactNode;
}

export function SolutionReview({
  selectedId,
  onPointOpen,
  onDispute,
  disputedIds,
  sourceAction,
}: SolutionReviewProps) {
  const styles = layout.experimentalSolution;
  const copy = EXPERIMENTAL_COPY.solution;

  return (
    <article className={styles.root}>
      <div className={styles.header} data-experimental-solution-header>
        <div className={styles.heading}>
          <ScreenHeading title={copy.title} as="h2" variant="task" />
          <span className={styles.recognized}>
            <ScanLine className={styles.recognizedIcon} aria-hidden="true" />
            {copy.subtitle}
          </span>
        </div>
        {sourceAction}
      </div>
      {EXPERIMENTAL_SOLUTION.filter((section) => !section.pointId).map((section) => (
        <div key={section.id} className={styles.condition}>
          <p className={styles.conditionLabel}>{copy.taskLabel}</p>
          {section.formulas.map((formula) => (
            <MathFormula
              key={formula}
              value={formula}
              className={styles.conditionFormula}
              displayMode
            />
          ))}
        </div>
      ))}
      <div className={styles.body}>
        {EXPERIMENTAL_SOLUTION.map((section) => (
          <SolutionStep
            key={section.id}
            section={section}
            selected={selectedId === section.pointId}
            hoverEnabled={selectedId === null || selectedId === section.pointId}
            disputed={Boolean(section.pointId && disputedIds.includes(section.pointId))}
            onPointOpen={onPointOpen}
            onDispute={onDispute}
          />
        ))}
      </div>
    </article>
  );
}
