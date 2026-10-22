import { Button } from '@/components/ui/button';
import type { ExpertTask } from '@/config/expert';
import { EXPERT_REVIEW_COPY } from '@/config/expert-review';
import { layout } from '@/config/layout';
import type { GridUi, GridWorkspace } from '@/hooks/use-grid-ui';
import { useExpertReviewAction } from '@/hooks/use-expert-review-action';
import { cn } from '@/lib/utils';

export function ExpertReviewFooter({
  task,
  workspace,
  ui,
}: {
  task: ExpertTask;
  workspace: GridWorkspace;
  ui: GridUi;
}) {
  const styles = layout.expert;
  const action = useExpertReviewAction(task, workspace, ui);
  const Icon = action.icon;

  return (
    <div className={styles.stickyApproval}>
      {workspace.dirty ? (
        <Button variant="ghost" onClick={workspace.discardChanges} disabled={workspace.busy}>
          {EXPERT_REVIEW_COPY.reset}
        </Button>
      ) : null}
      <Button
        variant={task.approved ? 'success' : 'default'}
        className={cn(styles.fullButton, task.approved && styles.checkedApproval)}
        onClick={action.onClick}
        disabled={action.disabled}
      >
        <Icon aria-hidden="true" />
        {action.label}
      </Button>
      <p className={styles.footerHint} role="status">
        {action.hint}
      </p>
    </div>
  );
}
