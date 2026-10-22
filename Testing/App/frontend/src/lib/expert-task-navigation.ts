import { EXPERT_COPY, type ExpertTask } from '@/config/expert';
import { EXPERT_TASK_NAVIGATION as COPY } from '@/config/expert-task-navigation';
import type { TaskStatus } from '@/config/tasks';

export function expertTaskNavigationItems(tasks: readonly ExpertTask[]) {
  return tasks.map((task, index) => {
    const { score, maxScore, hasGrade, gradeStale } = task.analysis;
    const graded =
      task.approved &&
      hasGrade !== false &&
      !gradeStale &&
      Number.isFinite(score) &&
      Number.isFinite(maxScore) &&
      maxScore > 0 &&
      score >= 0 &&
      score <= maxScore;
    const status: TaskStatus = !graded
      ? 'unverified'
      : score === 0
        ? 'incorrect'
        : score === maxScore
          ? 'correct'
          : 'partial';
    const label = EXPERT_COPY.taskLabel(index);
    const position = COPY.position(label, tasks.length);
    const state = task.approved ? EXPERT_COPY.approvedTask : COPY.pending;
    const scoreDescription = graded ? COPY.scoreDescription(score, maxScore) : undefined;

    return {
      id: task.id,
      label,
      status,
      score: graded ? COPY.score(score, maxScore) : null,
      ariaLabel: COPY.description(position, state, scoreDescription),
    };
  });
}
