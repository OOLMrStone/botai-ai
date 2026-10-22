import { ArrowLeft } from 'lucide-react';
import { ExpertTaskTabs } from '@/components/expert/ExpertTaskTabs';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY, type ExpertTask, type ExpertWork } from '@/config/expert';
import { layout } from '@/config/layout';
import type { GridUi, GridWorkspace } from '@/hooks/use-grid-ui';
import { cn } from '@/lib/utils';

export function ExpertReviewHeader({
  work,
  task,
  workspace,
  ui,
}: {
  work: ExpertWork;
  task: ExpertTask;
  workspace: GridWorkspace;
  ui: GridUi;
}) {
  const styles = layout.expert;

  return (
    <div className={styles.reviewHeader}>
      <div className={styles.reviewIdentity}>
        <Button
          size="icon-compact"
          variant="outline"
          className={layout.expertTaskNavigation.back}
          onClick={() => workspace.setView('queue')}
          aria-label={COPY.back}
        >
          <ArrowLeft />
        </Button>
        <div className={styles.reviewName}>
          <span className={cn(styles.studentAvatar, layout.expertTaskNavigation.avatar)}>
            {work.student.initials}
          </span>
          <div className={styles.reviewMetadata}>
            <ScreenHeading title={work.student.name} variant="app" />
          </div>
        </div>
      </div>
      <div className={styles.reviewTaskBar} data-expert-section-nav>
        <span className={styles.reviewTaskNumber}>{COPY.taskNumber(task.number)}</span>
        <ExpertTaskTabs tasks={work.tasks} currentTaskId={task.id} onSelect={ui.selectTask} />
      </div>
    </div>
  );
}
