import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ExpertDiagramContent } from '@/components/expert/ExpertDiagramContent';
import { ExpertStepDescription } from '@/components/expert/ExpertStepDescription';
import type { ExpertStepBlock } from '@/config/expert';
import { EXPERT_SOLUTION_COPY as COPY } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { useExpertArtifact } from '@/hooks/use-expert-artifact';
import { expertStepTextParts } from '@/lib/expert-step-text';

export function ExpertStepImage({ image }: { image: NonNullable<ExpertStepBlock['image']> }) {
  const styles = layout.expertSolution;
  const state = useExpertArtifact(image.url);

  if (!state.available || !image.url)
    return (
      <span className={styles.artifactUnavailable}>
        <ImageOff aria-hidden="true" />
        {COPY.artifactUnavailable}
      </span>
    );

  return (
    <span className={styles.artifactFrame}>
      <Image
        src={image.url}
        alt={image.alt}
        unoptimized
        width={image.width ?? styles.artifactFallback.width}
        height={image.height ?? styles.artifactFallback.height}
        className={styles.artifactImage}
        onError={state.fail}
      />
    </span>
  );
}

export function ExpertStepContent({
  block,
  showDescription = true,
}: {
  block: ExpertStepBlock;
  showDescription?: boolean;
}) {
  const styles = layout.expertSolution;
  const parts = expertStepTextParts(block.lines.join('\n'), block.diagram)
    .filter((part) => part.kind === 'text')
    .flatMap((part) =>
      part.value.split('\n').map((value, index) => ({ id: `${part.id}-${index}`, value })),
    )
    .filter((part) => part.value.trim());
  const Container = showDescription ? 'div' : 'span';

  return (
    <Container className={styles.stepContent}>
      {parts.map((part) => (
        <ExpertRichText key={part.id} value={part.value} className={styles.blockText} />
      ))}
      {block.image ? <ExpertStepImage image={block.image} /> : null}
      {block.diagram ? <ExpertDiagramContent diagram={block.diagram} /> : null}
      {showDescription ? <ExpertStepDescription block={block} /> : null}
    </Container>
  );
}
