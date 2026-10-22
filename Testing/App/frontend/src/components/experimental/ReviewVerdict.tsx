import { ArrowDownRight, Check, CircleAlert, FileText, Lightbulb, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EXPERIMENTAL_WORKSPACE_COPY as COPY } from '@/config/experimental-workspace';
import { layout } from '@/config/layout';
import type { useExperimentalReview } from '@/hooks/use-experimental-review';
import { cn } from '@/lib/utils';

type Review = ReturnType<typeof useExperimentalReview>;

export function ReviewVerdict({ review }: { review: Review }) {
  const styles = layout.experimental;

  return (
    <aside className={styles.aside}>
      <div className={styles.verdictBody}>
        <section className={styles.scoreSummary}>
          <div className={styles.asideHeader}>
            <span className={styles.row}>
              {review.hasExpertVerdict ? COPY.expertVerdictTitle : COPY.verdictTitle}
            </span>
            <span className={styles.status}>
              {review.confirmed ? <Check className={styles.icon} /> : null}
              {review.confirmed ? COPY.approved : COPY.pending}
            </span>
          </div>
          <div className={styles.score}>
            <span className={styles.scoreValue}>{review.score}</span>
            <span className={styles.scoreMax}>{COPY.outOf(review.maxScore)}</span>
            <Button
              size="icon-compact"
              variant="ghost"
              className={styles.scoreEdit}
              aria-label={COPY.editVerdict}
              onClick={() => review.openEditor('verdict')}
            >
              <Pencil aria-hidden="true" />
            </Button>
          </div>
          <p className={styles.scoreReason}>{review.verdict}</p>
          <div className={styles.scoreFooter}>
            <Button
              size="compact"
              variant="ghost"
              className={styles.criterionButton}
              onClick={() => review.setCriterionOpen(true)}
            >
              <FileText aria-hidden="true" />
              {COPY.criterion}
            </Button>
          </div>
        </section>
        <div className={styles.rule} />
        <section className={styles.stack}>
          <button
            type="button"
            className={cn(
              styles.finding,
              review.selectedPointId === 'lost-point' && styles.findingSelected,
            )}
            aria-pressed={review.selectedPointId === 'lost-point'}
            onClick={() => review.selectPoint('lost-point')}
          >
            <CircleAlert className={styles.findingIcon} aria-hidden="true" />
            <span className={styles.findingBody}>
              <span className={styles.findingHeader}>
                <span className={styles.findingTitle}>{COPY.findingTitle}</span>
                <span className={styles.deduction}>{COPY.deduction}</span>
              </span>
              <span className={styles.findingCopy}>{COPY.findingDescription}</span>
              <span className={styles.findingLink}>{COPY.findingLink}</span>
            </span>
          </button>
          <div className={styles.consequence}>
            <ArrowDownRight
              aria-hidden="true"
              className={cn(
                styles.consequenceIcon,
                layout.experimentalSolution.tones.inherited.text,
              )}
            />
            <p>{COPY.consequence}</p>
          </div>
        </section>
        <section className={styles.advice}>
          <div className={styles.spread}>
            <span className={styles.row}>
              <Lightbulb className={styles.adviceIcon} aria-hidden="true" />
              <span className={styles.label}>{COPY.adviceTitle}</span>
            </span>
            <Button
              size="icon-compact"
              variant="ghost"
              aria-label={COPY.editAdvice}
              onClick={() => review.openEditor('advice')}
            >
              <Pencil aria-hidden="true" />
            </Button>
          </div>
          <p className={styles.adviceText}>{review.advice}</p>
        </section>
      </div>
      <div className={styles.approval}>
        <Button
          className={styles.fullButton}
          variant={review.confirmed ? 'success' : 'default'}
          onClick={review.confirmReview}
        >
          <Check />
          {review.confirmed ? COPY.confirmed : COPY.confirm}
        </Button>
        <p className={styles.footerHint}>
          {review.confirmed ? COPY.confirmedHint : COPY.confirmationHint}
        </p>
      </div>
    </aside>
  );
}
