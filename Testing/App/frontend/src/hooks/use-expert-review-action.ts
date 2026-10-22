import { EXPERT_COPY, type ExpertTask } from '@/config/expert';
import { EXPERT_REVIEW_ACTIONS } from '@/config/expert-review';
import type { GridUi, GridWorkspace } from '@/hooks/use-grid-ui';
import { expertReviewStep } from '@/lib/expert-review';

export function useExpertReviewAction(task: ExpertTask, workspace: GridWorkspace, ui: GridUi) {
  const step = expertReviewStep(task);
  const presentation = EXPERT_REVIEW_ACTIONS[step.action];
  const handlers = {
    findings: () => ui.setDialog('findings'),
    grade: workspace.gradeTask,
    queued: () => undefined,
    pending: () => undefined,
    refresh: workspace.retry,
    confirm: workspace.approveTask,
    reject: workspace.approveTask,
    approved: () => undefined,
  };

  return {
    ...presentation,
    label: workspace.busy ? EXPERT_COPY.saving : presentation.label,
    hint: step.hint,
    disabled:
      workspace.busy ||
      step.action === 'pending' ||
      step.action === 'queued' ||
      task.approved ||
      task.readOnly,
    onClick: () => void handlers[step.action](),
  };
}
