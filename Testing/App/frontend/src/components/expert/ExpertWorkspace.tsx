'use client';

import { ExpertHeader } from '@/components/expert/ExpertHeader';
import { ExpertLogin } from '@/components/expert/ExpertLogin';
import { ExpertQueue } from '@/components/expert/ExpertQueue';
import { ExpertStudents } from '@/components/expert/ExpertStudents';
import { ExpertReviewHeader } from '@/components/expert/ExpertReviewHeader';
import { ExpertSolution } from '@/components/expert/ExpertSolution';
import { ExpertVerdict } from '@/components/expert/ExpertVerdict';
import { ExpertDialogs } from '@/components/expert/ExpertDialogs';
import { ExpertSource } from '@/components/expert/ExpertSource';
import { ExpertSourcePane } from '@/components/expert/ExpertSourcePane';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY } from '@/config/expert';
import { EXPERT_UI_COPY as UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useExpertWorkspace } from '@/hooks/use-expert-workspace';
import { useGridUi } from '@/hooks/use-grid-ui';
import { cn } from '@/lib/utils';

export function ExpertWorkspace() {
  const workspace = useExpertWorkspace();
  const ui = useGridUi(workspace);
  const styles = layout.expert;
  const task = workspace.selectedTask;
  const work = workspace.selectedWork;
  const sourceOpen = ui.sourceOpen && Boolean(task?.sourceImages?.length || task?.sourceImage);

  return (
    <div
      className={cn(styles.root, sourceOpen && workspace.view === 'review' && styles.rootCompare)}
    >
      <ExpertHeader
        workspace={workspace}
        ui={ui}
        compact={sourceOpen && workspace.view === 'review'}
      />
      {workspace.error ? (
        <div className={cn(styles.notice, styles.noticeError)} role="alert">
          <span>{workspace.error}</span>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => void workspace.retry()}
            disabled={workspace.busy}
          >
            {COPY.retry}
          </Button>
        </div>
      ) : null}
      {workspace.loading ? (
        <main className={styles.loading} role="status">
          {COPY.loading}
        </main>
      ) : !workspace.session ? (
        <ExpertLogin workspace={workspace} />
      ) : workspace.view === 'students' ? (
        <ExpertStudents workspace={workspace} ui={ui} />
      ) : workspace.view === 'review' && task && work ? (
        <main className={cn(styles.review, sourceOpen && styles.reviewCompare)} data-expert-review>
          <ExpertReviewHeader workspace={workspace} ui={ui} task={task} work={work} />
          <div className={cn(styles.reviewPanes, sourceOpen && styles.reviewPanesCompare)}>
            {sourceOpen ? (
              <div className={styles.sourcePane}>
                <ExpertSourcePane key={task.id} task={task} onClose={ui.closeSource} />
              </div>
            ) : null}
            <div
              className={cn(styles.columns, sourceOpen && styles.columnsCompare)}
              data-expert-document={sourceOpen ? '' : undefined}
              tabIndex={sourceOpen ? 0 : undefined}
              role={sourceOpen ? 'region' : undefined}
              aria-label={sourceOpen ? UI.reviewPane : undefined}
            >
              <div
                className={cn(styles.document, sourceOpen && styles.documentCompare)}
                data-expert-document={sourceOpen ? undefined : ''}
              >
                <ScreenTransition key={task.id}>
                  <div className={styles.paper}>
                    <ExpertSolution
                      task={task}
                      selectedBlockId={ui.selectedBlockId}
                      onSelectBlock={ui.setSelectedBlockId}
                      onRevealBlock={ui.revealBlock}
                      onEditBlock={ui.setEditingBlockId}
                      editingDisabled={workspace.busy}
                      sourceAction={
                        !sourceOpen && (task.sourceImages?.length || task.sourceImage) ? (
                          <ExpertSource onOpen={ui.openSource} />
                        ) : null
                      }
                    />
                  </div>
                </ScreenTransition>
              </div>
              <ExpertVerdict task={task} workspace={workspace} ui={ui} comparing={sourceOpen} />
            </div>
          </div>
        </main>
      ) : (
        <ExpertQueue workspace={workspace} ui={ui} />
      )}
      <ExpertDialogs workspace={workspace} ui={ui} />
      {workspace.feedback ? (
        <div className={styles.feedback} role="status" onClick={workspace.clearFeedback}>
          {workspace.feedback}
        </div>
      ) : null}
    </div>
  );
}
