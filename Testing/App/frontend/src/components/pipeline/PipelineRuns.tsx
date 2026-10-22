import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { PipelineStatus } from '@/components/pipeline/PipelineStatus';
import { Button } from '@/components/ui/button';
import { PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { layout } from '@/config/layout';
import type { PipelineConsoleState } from '@/hooks/use-pipeline-console';
import { pipelineTime } from '@/lib/pipeline-console';
import { cn } from '@/lib/utils';

export function PipelineRuns({ workspace }: { workspace: PipelineConsoleState }) {
  const styles = layout.pipelineConsole;
  return (
    <nav
      className={cn(styles.list, workspace.selectedId && styles.listHidden)}
      aria-label={COPY.recent}
    >
      <p className={styles.listHeading}>{COPY.recent}</p>
      {workspace.listLoading ? (
        <p className={styles.listHeading} role="status">
          {COPY.loading}
        </p>
      ) : workspace.runs.length ? (
        workspace.runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={cn(styles.run, workspace.selectedId === run.id && styles.selected)}
            aria-current={workspace.selectedId === run.id ? 'true' : undefined}
            onClick={() => workspace.select(run.id)}
          >
            <span className={styles.runTop}>
              <span className={styles.runTitle}>{COPY.taskNumber(run.taskNumber)}</span>
              <time className={styles.timestamp} dateTime={run.createdAt}>
                {pipelineTime(run.createdAt, true)}
              </time>
            </span>
            <span className={styles.secondary}>{COPY.origin[run.origin]}</span>
            <PipelineStatus state={run.state} />
          </button>
        ))
      ) : (
        <div className={styles.empty}>
          <ScreenHeading title={COPY.emptyTitle} variant="task" as="h2" />
          <p className={styles.secondary}>{COPY.emptyHint}</p>
        </div>
      )}
      {workspace.nextCursor ? (
        <Button
          variant="ghost"
          className={styles.loadMore}
          disabled={workspace.loadingMore}
          onClick={() => void workspace.loadMore()}
        >
          {COPY.more}
        </Button>
      ) : null}
    </nav>
  );
}
