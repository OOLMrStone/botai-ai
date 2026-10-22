import { MathFormula } from '@/components/common/MathFormula';
import { ExpertDiagramContent } from '@/components/expert/ExpertDiagramContent';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ExpertStepContent } from '@/components/expert/ExpertStepContent';
import type { ExpertBlock } from '@/config/expert';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function ExpertBlockContent({
  block,
  showDescription = true,
}: {
  block: ExpertBlock;
  showDescription?: boolean;
}) {
  const styles = layout.expertSolution;

  switch (block.kind) {
    case 'step':
      return <ExpertStepContent block={block} showDescription={showDescription} />;
    case 'text':
      return <ExpertRichText value={block.text} className={styles.blockText} />;
    case 'number_line':
    case 'unit_circle':
      return <ExpertDiagramContent diagram={block} />;
    case 'math':
      return (
        <span className={cn(styles.formulas, block.layout === 'columns' && styles.formulasColumns)}>
          {block.formulas.map((formula, index) => (
            <MathFormula
              key={index}
              value={formula}
              className={cn(
                styles.formula,
                (block.layout === 'columns' || block.width === 'half') && styles.formulaCompact,
                block.status === 'error' && styles.tones.error.text,
              )}
              displayMode
              inline
            />
          ))}
        </span>
      );
  }
}
