import { Popover } from '@base-ui/react/popover';
import { ArrowDownRight, Pencil, X } from 'lucide-react';
import { ExpertBlockContent } from '@/components/expert/ExpertBlockContent';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ExpertStepDescription } from '@/components/expert/ExpertStepDescription';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY, type ExpertBlock } from '@/config/expert';
import { EXPERT_SOLUTION_COPY, EXPERT_SOLUTION_STATUSES } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface ExpertSolutionBlockProps {
  block: ExpertBlock;
  number: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onRevealRelated: (id: string) => void;
  onEdit: (id: string) => void;
  readOnly?: boolean;
  editingDisabled?: boolean;
  relatedBlocks?: Pick<ExpertBlock, 'id' | 'title'>[];
}

export function ExpertSolutionBlock({
  block,
  number,
  selected,
  onSelect,
  onRevealRelated,
  onEdit,
  readOnly = false,
  editingDisabled = false,
  relatedBlocks = [],
}: ExpertSolutionBlockProps) {
  const styles = layout.expertSolution;
  const status = block.status ?? 'pending';
  const tone = styles.tones[status];
  const { icon: Icon } = EXPERT_SOLUTION_STATUSES[status];
  const statusLabel = styles.statusLabels[status];

  return (
    <section
      className={cn(
        styles.section,
        styles.block,
        block.kind === 'math' && block.width === 'half' && styles.sectionHalf,
      )}
      data-expert-block={block.id}
    >
      <Popover.Root open={selected} onOpenChange={(open) => onSelect(open ? block.id : null)}>
        <Popover.Trigger
          render={
            <button
              type="button"
              aria-label={block.title}
              className={cn(styles.trigger, styles.blockTrigger)}
            />
          }
        >
          <span
            aria-hidden="true"
            className={cn(
              styles.highlight,
              tone.background,
              selected ? styles.highlightSelected : styles.highlightHover,
            )}
          />
          <span aria-hidden="true" className={cn(styles.marker, tone.marker)} />
          <span className={styles.number}>{number}</span>
          <span className={styles.content}>
            <span className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>{block.title}</span>
              <span className={cn(styles.status, block.status === 'error' && tone.text)}>
                <Icon className={cn(styles.statusIcon, tone.text)} aria-hidden="true" />
                <span className={block.status === 'correct' ? styles.statusTextHidden : undefined}>
                  {statusLabel}
                </span>
              </span>
            </span>
            <ExpertBlockContent block={block} showDescription={false} />
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="right"
            align="start"
            sideOffset={styles.popover.sideOffset}
            collisionPadding={styles.popover.collisionPadding}
            positionMethod="fixed"
            className={styles.popoverPositioner}
          >
            <Popover.Popup
              initialFocus={false}
              aria-label={block.title}
              className={styles.popoverSurface}
            >
              <div className={styles.detailHeader}>
                <div className={styles.detailHeading}>
                  <p className={styles.detailEyebrow}>
                    <span className={cn(styles.detailDot, tone.marker)} />
                    {statusLabel}
                  </p>
                  <ScreenHeading title={block.title} as="h3" variant="task" />
                </div>
                <Popover.Close
                  render={
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      aria-label={EXPERT_SOLUTION_COPY.closeComment}
                    />
                  }
                >
                  <X aria-hidden="true" />
                </Popover.Close>
              </div>
              {block.explanation ? (
                <div className={styles.detailBody}>
                  <ExpertRichText className={styles.detailText} value={block.explanation} />
                </div>
              ) : null}
              {relatedBlocks.length ? (
                <div className={styles.detailBody}>
                  {relatedBlocks.map((related) => (
                    <Button
                      key={related.id}
                      type="button"
                      variant="ghost"
                      size="multiline"
                      className={styles.relatedAction}
                      onClick={() => onRevealRelated(related.id)}
                    >
                      <ArrowDownRight aria-hidden="true" />
                      {EXPERT_SOLUTION_COPY.followsFrom(related.title)}
                    </Button>
                  ))}
                </div>
              ) : null}
              {!readOnly ? (
                <div className={styles.detailActions}>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={editingDisabled}
                    onClick={() => onEdit(block.id)}
                  >
                    <Pencil aria-hidden="true" />
                    {EXPERT_COPY.editStep}
                  </Button>
                </div>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {block.kind === 'step' ? (
        <ExpertStepDescription block={block} className={styles.blockDescription} />
      ) : null}
      {!readOnly ? (
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={EXPERT_SOLUTION_COPY.editBlock(block.title)}
          className={styles.editAction}
          disabled={editingDisabled}
          onClick={() => onEdit(block.id)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}
