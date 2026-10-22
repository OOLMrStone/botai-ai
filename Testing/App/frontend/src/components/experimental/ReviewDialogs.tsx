import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { DialogSheet } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MathFormula } from '@/components/common/MathFormula';
import { EXPERIMENTAL_COPY, EXPERIMENTAL_MATH } from '@/config/experimental';
import {
  EXPERIMENTAL_WORKSPACE as WORKSPACE,
  EXPERIMENTAL_WORKSPACE_COPY as COPY,
} from '@/config/experimental-workspace';
import { layout } from '@/config/layout';
import type { useExperimentalReview } from '@/hooks/use-experimental-review';
import { cn } from '@/lib/utils';

type Review = ReturnType<typeof useExperimentalReview>;

function PhotoPreview({ photoUrl }: { photoUrl: string }) {
  return (
    <div className={layout.experimental.photoExpanded}>
      <Image
        src={photoUrl}
        alt={EXPERIMENTAL_COPY.sourceAlt}
        fill
        unoptimized
        className={layout.experimental.photoImage}
      />
    </div>
  );
}

function ReviewEditor({ review }: { review: Review }) {
  const styles = layout.experimental;
  const editingVerdict = review.editor === 'verdict';

  return (
    <DialogSheet
      open={review.editor !== null}
      title={editingVerdict ? COPY.editVerdict : COPY.editAdvice}
      closeLabel={COPY.close}
      onOpenChange={review.setEditorOpen}
    >
      <div className={styles.dialogBody}>
        {editingVerdict ? (
          <div className={styles.stack}>
            <span className={styles.label}>{COPY.scoreLabel}</span>
            <div className={styles.scoreOptions}>
              {WORKSPACE.scoreOptions.map((score) => (
                <Button
                  key={score}
                  variant={review.draftScore === score ? 'default' : 'outline'}
                  aria-pressed={review.draftScore === score}
                  onClick={() => review.setDraftScore(score)}
                >
                  {score}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <label className={styles.inputLabel}>
          {editingVerdict ? COPY.verdictLabel : COPY.adviceLabel}
          <textarea
            className={styles.textarea}
            value={review.draftText}
            onChange={(event) => review.setDraftText(event.target.value)}
          />
        </label>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={review.closeEditor}>
            {COPY.cancel}
          </Button>
          <Button onClick={review.saveEdit} disabled={!review.canSaveEdit}>
            {COPY.save}
          </Button>
        </div>
      </div>
    </DialogSheet>
  );
}

export function ReviewDialogs({ review }: { review: Review }) {
  const styles = layout.experimental;

  return (
    <>
      <DialogSheet
        open={review.sourceOpen}
        title={COPY.source}
        closeLabel={COPY.close}
        onOpenChange={review.setSourceOpen}
        className={styles.photoDialog}
        headerActions={
          <Button
            variant="ghost"
            size="compact"
            className={styles.photoExternalAction}
            aria-label={COPY.sourceFullSize}
            nativeButton={false}
            render={<a href={review.photoUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink aria-hidden="true" />
            <span className={styles.photoExternalLabel}>{COPY.sourceFullSize}</span>
          </Button>
        }
      >
        <div className={styles.photoDialogBody}>
          <PhotoPreview photoUrl={review.photoUrl} />
        </div>
      </DialogSheet>
      <ReviewEditor review={review} />
      <DialogSheet
        open={review.criterionOpen}
        title={COPY.criterionTitle}
        closeLabel={COPY.close}
        onOpenChange={review.setCriterionOpen}
      >
        <div className={styles.dialogBody}>
          <p className={styles.caption}>{COPY.criterionLabel}</p>
          <div className={cn(styles.criterion, styles.criterionActive)}>
            <span className={styles.label}>{COPY.criterionScore}</span>
            <p className={styles.body}>{EXPERIMENTAL_COPY.verdict}</p>
          </div>
          <div>
            <span className={styles.label}>{COPY.lostPointTitle}</span>
            <MathFormula value={EXPERIMENTAL_MATH.isolatedPoint} className={styles.reference} />
          </div>
          <div>
            <span className={styles.label}>{COPY.referenceTitle}</span>
            <MathFormula value={EXPERIMENTAL_MATH.correctAnswer} className={styles.reference} />
          </div>
          <p className={styles.caption}>{COPY.criterionOrigin}</p>
        </div>
      </DialogSheet>
    </>
  );
}
