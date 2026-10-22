import type { ReactNode } from 'react';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function ExpertDiagramDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const styles = layout.expertSolution;

  return (
    <details className={cn(styles.description, className)}>
      <summary className={styles.descriptionSummary}>
        {EXPERT_SOLUTION_COPY.diagramDescription}
      </summary>
      <div className={styles.descriptionBody}>{children}</div>
    </details>
  );
}
