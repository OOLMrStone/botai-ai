import { Check, CircleAlert, FileText, Lightbulb, Pencil } from 'lucide-react';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ExpertReviewFooter } from '@/components/expert/ExpertReviewFooter';
import { expertFindingNeedsReview } from '@/lib/expert';
import { gridReviewPresentation } from '@/lib/grid-view';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY, type ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY as UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import type { GridUi, GridWorkspace } from '@/hooks/use-grid-ui';
import { cn } from '@/lib/utils';

export function ExpertVerdict({
  task,
  workspace,
  ui,
  comparing = false,
}: {
  task: ExpertTask;
  workspace: GridWorkspace;
  ui: GridUi;
  comparing?: boolean;
}) {
  const styles = layout.expert;
  const { analysis } = task;
  const presentation = gridReviewPresentation(task);

  return (
    <aside
      className={cn(styles.aside, styles.reviewAnchor, comparing && styles.asideCompare)}
      data-expert-verdict
    >
      <div
        className={cn(styles.verdictBody, comparing && styles.verdictBodyCompare)}
        data-expert-verdict-body
      >
        <section className={styles.scoreSummary}>
          <div className={styles.asideHeader}>
            <span>{task.updatedByExpert ? COPY.expertVerdictTitle : COPY.verdictTitle}</span>
            <span className={styles.status}>
              {task.approved ? <Check className={styles.icon} /> : null}
              {task.approved ? COPY.approved : COPY.pending}
            </span>
          </div>
          <div className={styles.score}>
            {analysis.rejectedReason ? (
              <span className={styles.body}>{UI.rejected}</span>
            ) : analysis.hasGrade === false ? (
              <span className={styles.body}>{UI.ungraded}</span>
            ) : (
              <>
                <span className={styles.scoreValue}>{analysis.score}</span>
                <span className={styles.scoreMax}>{COPY.outOf(analysis.maxScore)}</span>
              </>
            )}
            <Button
              size="icon-compact"
              variant="ghost"
              className={styles.scoreEdit}
              aria-label={COPY.editVerdict}
              onClick={() => ui.setDialog('score')}
              disabled={workspace.busy || task.readOnly}
            >
              <Pencil />
            </Button>
          </div>
          <ExpertRichText
            className={styles.scoreReason}
            value={analysis.rejectedReason || analysis.verdict}
          />
          {analysis.gradeStale ? <p className={styles.unsaved}>{UI.gradeStale}</p> : null}
          <div className={styles.scoreFooter}>
            <Button
              size="compact"
              variant="ghost"
              className={styles.criterionButton}
              onClick={() => ui.setDialog('criterion')}
            >
              <FileText />
              {COPY.criterion}
            </Button>
          </div>
        </section>
        <div className={styles.rule} />
        <section className={styles.stack}>
          {analysis.findings.map((finding) => (
            <div key={finding.id} className={styles.findingContainer}>
              <button
                type="button"
                className={styles.finding}
                onClick={() => finding.blockId && ui.revealBlock(finding.blockId)}
                disabled={!finding.blockId}
              >
                <CircleAlert className={styles.findingIcon} aria-hidden="true" />
                <span className={styles.findingBody}>
                  <span className={cn(styles.findingHeader, styles.findingContent)}>
                    <ExpertRichText className={styles.findingTitle} value={finding.title} />
                    {finding.deduction !== undefined && finding.deduction > 0 ? (
                      <span className={styles.deduction}>{UI.deduction(finding.deduction)}</span>
                    ) : null}
                  </span>
                  <ExpertRichText className={styles.findingCopy} value={finding.description} />
                  {expertFindingNeedsReview(task, finding) ? (
                    <span className={styles.unsaved}>{COPY.findingNeedsReview}</span>
                  ) : null}
                  {finding.blockId ? (
                    <span className={styles.findingLink}>{COPY.findingLink}</span>
                  ) : null}
                </span>
              </button>
              {!task.readOnly ? (
                <Button
                  size="icon-compact"
                  variant="ghost"
                  className={styles.findingEdit}
                  aria-label={UI.editFindings}
                  onClick={() => ui.setDialog('findings')}
                  disabled={workspace.busy}
                >
                  <Pencil />
                </Button>
              ) : null}
            </div>
          ))}
          {!analysis.findings.length ? (
            <div className={styles.findingEmpty}>
              <span>{presentation.emptyFindings}</span>
              {!task.readOnly ? (
                <Button
                  size="icon-compact"
                  variant="ghost"
                  aria-label={UI.editFindings}
                  onClick={() => ui.setDialog('findings')}
                  disabled={workspace.busy}
                >
                  <Pencil />
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className={styles.advice}>
          <div className={styles.spread}>
            <span className={styles.row}>
              <Lightbulb className={styles.adviceIcon} />
              <span className={styles.label}>{COPY.adviceTitle}</span>
            </span>
            <Button
              size="icon-compact"
              variant="ghost"
              aria-label={COPY.editAdvice}
              onClick={() => ui.setDialog('advice')}
              disabled={workspace.busy || task.readOnly}
            >
              <Pencil />
            </Button>
          </div>
          <ExpertRichText className={styles.adviceText} value={analysis.advice || UI.adviceEmpty} />
        </section>
        {analysis.summary && analysis.summary !== analysis.verdict ? (
          <details className={styles.stack}>
            <summary className={styles.label}>{UI.generalReview}</summary>
            <ExpertRichText className={styles.adviceText} value={analysis.summary} />
          </details>
        ) : null}
      </div>
      <ExpertReviewFooter task={task} workspace={workspace} ui={ui} />
    </aside>
  );
}
