import { ArrowLeft, ChevronDown } from 'lucide-react';
import { ErrorNote } from '@/components/common/ErrorNote';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { PipelineArtifact } from '@/components/pipeline/PipelineArtifact';
import { PipelineInputs } from '@/components/pipeline/PipelineInputs';
import { PipelineImage } from '@/components/pipeline/PipelineImage';
import { PipelineStages } from '@/components/pipeline/PipelineStages';
import { PipelineStatus } from '@/components/pipeline/PipelineStatus';
import { Button } from '@/components/ui/button';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineConsoleState } from '@/hooks/use-pipeline-console';
import {
  pipelineErrorCode,
  pipelineFailureLabel,
  pipelinePollMs,
  pipelineTime,
} from '@/lib/pipeline-console';
import { cn } from '@/lib/utils';

export function PipelineRunDetail({ workspace }: { workspace: PipelineConsoleState }) {
  const styles = layout.pipelineConsole;
  const selected = workspace.selected;
  const run = selected?.detail;
  return (
    <main className={cn(styles.detail, !workspace.selectedId && styles.detailHidden)}>
      <div className={styles.detailContent}>
        {workspace.selectedId ? (
          <Button variant="ghost" className={styles.back} onClick={() => workspace.select(null)}>
            <ArrowLeft aria-hidden="true" />
            {COPY.back}
          </Button>
        ) : null}
        {selected?.error ? (
          <ErrorNote message={selected.error} onRetry={workspace.refresh} />
        ) : null}
        {selected?.error && run ? <p className={styles.secondary}>{COPY.stale}</p> : null}
        {!workspace.selectedId ? (
          <div className={styles.empty}>
            <ScreenHeading title={COPY.chooseRun} variant="task" as="h2" />
            <p className={styles.secondary}>{COPY.chooseRunHint}</p>
          </div>
        ) : !run ? (
          !selected?.error ? (
            <p role="status" className={styles.secondary}>
              {COPY.loadingRun}
            </p>
          ) : null
        ) : (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>
                <ScreenHeading title={COPY.taskNumber(run.taskNumber)} variant="app" as="h2" />
                <span className={styles.secondary}>
                  {COPY.origin[run.origin]} · {pipelineTime(run.createdAt, true)}
                </span>
              </div>
              <PipelineStatus state={run.state} />
            </div>
            <PipelineStages events={selected.events} />
            {run.errorCode || run.failure ? (
              <section className={styles.section}>
                <ErrorNote
                  message={
                    pipelineFailureLabel(run.failure) || pipelineErrorCode(run.errorCode ?? '')
                  }
                />
                <details>
                  <summary className={styles.eventDetails}>{COPY.details}</summary>
                  <pre className={styles.json}>
                    {run.failure
                      ? JSON.stringify({ errorCode: run.errorCode, ...run.failure }, null, 2)
                      : run.errorCode}
                  </pre>
                </details>
              </section>
            ) : null}
            <section className={styles.panel} aria-label={COPY.result}>
              <p className={styles.sectionTitle}>{COPY.result}</p>
              {run.aiResult ? (
                <>
                  {run.aiResult.grading ? (
                    <>
                      <p className={styles.score}>
                        {COPY.score(run.aiResult.grading.score, run.task.maxScore)}
                      </p>
                      <ExpertRichText value={run.aiResult.grading.explanation} />
                    </>
                  ) : run.aiResult.rejection_reason ? (
                    <ExpertRichText value={run.aiResult.rejection_reason} />
                  ) : null}
                  <p className={styles.secondary}>{COPY.verified}</p>
                  <details className={styles.disclosure}>
                    <summary className={styles.summary}>
                      {COPY.resultJson}
                      <ChevronDown className={styles.chevron} aria-hidden="true" />
                    </summary>
                    <div className={styles.disclosureBody}>
                      <pre className={styles.json}>{JSON.stringify(run.aiResult, null, 2)}</pre>
                    </div>
                  </details>
                </>
              ) : (
                <p className={styles.secondary}>
                  {pipelinePollMs(run.state) === null ? COPY.resultUnavailable : COPY.resultEmpty}
                </p>
              )}
            </section>
            <PipelineInputs run={run} />
            {run.imageArtifacts?.length ? (
              <details className={styles.disclosure}>
                <summary className={styles.summary}>
                  {COPY.diagrams}
                  <ChevronDown className={styles.chevron} aria-hidden="true" />
                </summary>
                <div className={styles.disclosureBody}>
                  <div className={styles.mediaGrid}>
                    {run.imageArtifacts.map((artifact, index) => (
                      <PipelineImage
                        key={artifact.id}
                        src={artifact.previewUrl}
                        title={COPY.diagram(index)}
                        width={artifact.width}
                        height={artifact.height}
                      />
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            {run.artifacts.length ? (
              <section className={styles.section} aria-label={COPY.artifacts}>
                <p className={styles.sectionTitle}>{COPY.artifacts}</p>
                {run.artifacts.map((artifact) => (
                  <PipelineArtifact key={artifact.id} artifact={artifact} />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
