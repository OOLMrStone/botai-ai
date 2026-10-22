import { Plus, RefreshCw } from 'lucide-react';
import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { PipelineRunDetail } from '@/components/pipeline/PipelineRunDetail';
import { PipelineRuns } from '@/components/pipeline/PipelineRuns';
import { PipelineSubmissionForm } from '@/components/pipeline/PipelineSubmissionForm';
import { Button } from '@/components/ui/button';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineConsoleState } from '@/hooks/use-pipeline-console';
import { usePipelineSubmission } from '@/hooks/use-pipeline-submission';

export function PipelineWorkspace({ workspace }: { workspace: PipelineConsoleState }) {
  const form = usePipelineSubmission(workspace.accept);
  const styles = layout.pipelineConsole;
  return (
    <>
      <div className={styles.heading}>
        <ScreenHeading title={COPY.title} variant="app" />
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={COPY.refresh}
            onClick={workspace.refresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button onClick={() => form.close(true)}>
            <Plus aria-hidden="true" />
            {COPY.newRun}
          </Button>
        </div>
      </div>
      {workspace.error ? (
        <div className={styles.notice}>
          <ErrorNote message={workspace.error} onRetry={workspace.refresh} />
        </div>
      ) : null}
      <div className={styles.body}>
        <PipelineRuns workspace={workspace} />
        <PipelineRunDetail workspace={workspace} />
      </div>
      <PipelineSubmissionForm form={form} />
    </>
  );
}
