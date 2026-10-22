import { ExpertDiagramDescription } from '@/components/expert/ExpertDiagramDescription';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import type { ExpertStepBlock } from '@/config/expert';
import { layout } from '@/config/layout';
import { expertStepTextParts } from '@/lib/expert-step-text';

export function ExpertStepDescription({
  block,
  className,
}: {
  block: ExpertStepBlock;
  className?: string;
}) {
  const descriptions = expertStepTextParts(block.lines.join('\n'), block.diagram).filter(
    (part) => part.kind === 'description',
  );
  if (!descriptions.length) return null;

  return (
    <ExpertDiagramDescription className={className}>
      {descriptions.map((part) => (
        <ExpertRichText
          key={part.id}
          value={part.value}
          className={layout.expertSolution.blockText}
        />
      ))}
    </ExpertDiagramDescription>
  );
}
