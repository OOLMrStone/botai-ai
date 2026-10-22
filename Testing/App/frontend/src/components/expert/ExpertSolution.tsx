import type { ReactNode } from 'react';
import { MathFormula } from '@/components/common/MathFormula';
import { ExpertSolutionBlock } from '@/components/expert/ExpertSolutionBlock';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { TaskBlockRenderer } from '@/components/tasks/TaskBlockRenderer';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import type { ExpertTask } from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { isGridMathStatement } from '@/lib/grid-rich-text';
import { gridReviewPresentation } from '@/lib/grid-view';

interface ExpertSolutionProps {
  task: ExpertTask;
  selectedBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
  onRevealBlock: (id: string) => void;
  onEditBlock: (id: string) => void;
  editingDisabled?: boolean;
  sourceAction?: ReactNode;
}

export function ExpertSolution({
  task,
  selectedBlockId,
  onSelectBlock,
  onRevealBlock,
  onEditBlock,
  editingDisabled = false,
  sourceAction,
}: ExpertSolutionProps) {
  const styles = layout.expertSolution;
  const copy = EXPERT_SOLUTION_COPY;
  const presentation = gridReviewPresentation(task);

  return (
    <article className={styles.root}>
      <div className={styles.condition}>
        <p className={styles.conditionLabel}>{copy.taskLabel}</p>
        {task.statementContent?.length ? (
          <TaskBlockRenderer blocks={task.statementContent} />
        ) : isGridMathStatement(task.statement) ? (
          <MathFormula value={task.statement} className={styles.conditionFormula} displayMode />
        ) : (
          <ExpertRichText value={task.statement} className={styles.conditionFormula} />
        )}
      </div>
      <div className={styles.header} data-expert-solution-header>
        <ScreenHeading title={copy.title} as="h2" variant="task" />
        {sourceAction}
      </div>
      <div className={styles.body}>
        {task.blocks.map((block, index) => (
          <ExpertSolutionBlock
            key={block.id}
            block={block}
            relatedBlocks={task.blocks.filter((candidate) =>
              block.followsFromBlockIds?.includes(candidate.id),
            )}
            number={copy.ordinal(index)}
            selected={selectedBlockId === block.id}
            onSelect={onSelectBlock}
            onRevealRelated={onRevealBlock}
            onEdit={onEditBlock}
            editingDisabled={editingDisabled}
            readOnly={task.readOnly}
          />
        ))}
      </div>
      {task.blocks.length === 0 ? (
        <p className={styles.empty}>{presentation.emptySolution}</p>
      ) : null}
    </article>
  );
}
