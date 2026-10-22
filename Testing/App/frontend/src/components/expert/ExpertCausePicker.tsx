import { Check } from 'lucide-react';
import { FormSection } from '@/components/common/FormSection';
import { ExpertBlockContent } from '@/components/expert/ExpertBlockContent';
import { Button } from '@/components/ui/button';
import type { ExpertBlock } from '@/config/expert';
import { EXPERT_CAUSE_PICKER_COPY as COPY } from '@/config/expert-cause-picker';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function ExpertCausePicker({
  candidates,
  selectedIds,
  onToggle,
  onMarkError,
  valid,
}: {
  candidates: ExpertBlock[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onMarkError: () => void;
  valid: boolean;
}) {
  const styles = layout.expertCausePicker;

  return (
    <FormSection title={COPY.title}>
      <div className={styles.root}>
        {candidates.length ? (
          <>
            <p className={styles.hint}>{COPY.hint}</p>
            <div className={styles.list}>
              {candidates.map((candidate) => (
                <ExpertCauseOption
                  key={candidate.id}
                  block={candidate}
                  selected={selectedIds.includes(candidate.id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
            {!valid ? <p className={styles.feedback}>{COPY.required}</p> : null}
          </>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyText}>
              <p className={styles.emptyTitle}>{COPY.empty}</p>
              <p className={styles.hint}>{COPY.emptyHint}</p>
            </div>
            <Button variant="outline" size="multiline" onClick={onMarkError}>
              {COPY.markError}
            </Button>
          </div>
        )}
      </div>
    </FormSection>
  );
}

function ExpertCauseOption({
  block,
  selected,
  onToggle,
}: {
  block: ExpertBlock;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const styles = layout.expertCausePicker;

  return (
    <button
      type="button"
      aria-label={block.title}
      aria-pressed={selected}
      className={cn(styles.option, selected && styles.selected)}
      onClick={() => onToggle(block.id)}
    >
      <span className={styles.header}>
        <span className={styles.title}>{block.title}</span>
        <span
          aria-label={selected ? COPY.selected : COPY.select}
          className={cn(styles.selection, selected && styles.selectionActive)}
        >
          {selected ? <Check className={styles.selectionIcon} aria-hidden="true" /> : null}
        </span>
      </span>
      <span className={styles.content}>
        <ExpertBlockContent block={block} showDescription={false} />
      </span>
    </button>
  );
}
