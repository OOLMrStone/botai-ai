import { EXPERT_COPY, type ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { EXPERT_REVIEW_COPY } from '@/config/expert-review';
import { expertTaskNeedsReview, expertGradeFailure, expertGradeFeedback } from '@/lib/expert';

export function expertReviewStep(task: ExpertTask) {
  const state = task.manualGradePending ? undefined : task.gradingJob?.state;
  const needsReview = expertTaskNeedsReview(task);

  if (task.approved) return { action: 'approved', hint: EXPERT_UI_COPY.taskApprovedHint } as const;
  if (state === 'queued') return { action: 'queued', hint: EXPERT_COPY.gradeQueued } as const;
  if (state === 'pending') return { action: 'pending', hint: EXPERT_COPY.gradePending } as const;
  if (state === 'unknown')
    return {
      action: 'refresh',
      hint: expertGradeFeedback(state, task.gradingJob?.failure),
    } as const;
  if (needsReview) return { action: 'findings', hint: EXPERT_COPY.findingsReviewFooter } as const;
  if (task.analysis.rejectedReason)
    return { action: 'reject', hint: EXPERT_REVIEW_COPY.rejectHint } as const;
  if (task.analysis.gradeStale || task.analysis.hasGrade === false)
    return {
      action: 'grade',
      hint:
        state === 'failed'
          ? expertGradeFailure(task.gradingJob?.failure)
          : state === 'stale'
            ? EXPERT_COPY.errors.gradeStale
            : task.analysis.gradeStale
              ? EXPERT_UI_COPY.gradeStale
              : EXPERT_UI_COPY.ungraded,
    } as const;

  return { action: 'confirm', hint: EXPERT_COPY.confirmationHint } as const;
}
