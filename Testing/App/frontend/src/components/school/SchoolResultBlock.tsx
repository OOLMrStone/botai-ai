import { ExpertBlockContent } from '@/components/expert/ExpertBlockContent';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import type { ExpertBlock } from '@/config/expert';
import { EXPERT_SOLUTION_STATUSES } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function SchoolResultBlock({ block }: { block: ExpertBlock }) {
  const styles = layout.school;
  const status = block.status ?? 'pending';
  const { icon: Icon } = EXPERT_SOLUTION_STATUSES[status];

  return (
    <div className={cn(styles.resultBlock, block.status && styles.resultTones[block.status])}>
      <div className={styles.resultBlockHeading}>
        <p className={styles.number}>{block.title}</p>
        <span className={styles.status}>
          <Icon className={styles.statusIcon} aria-hidden="true" />
          {layout.expertSolution.statusLabels[status]}
        </span>
      </div>
      <div className={styles.resultFormula}>
        <ExpertBlockContent block={block} />
      </div>
      {block.explanation ? (
        <ExpertRichText value={block.explanation} className={styles.resultText} />
      ) : null}
    </div>
  );
}
