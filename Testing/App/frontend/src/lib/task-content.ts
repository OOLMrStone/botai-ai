import { TASK_CONTENT, TASK_MEDIA_PATTERN, type TaskBlock, type TaskRun } from '@/config/tasks';
import { LEARNING_COPY } from '@/config/integration';
import type { AttemptItem, Solution } from '@/lib/api/learning-types';

export function taskMediaSrc(value: string) {
  return TASK_MEDIA_PATTERN.test(value) ? value : null;
}
export function formulaStyle(run: Extract<TaskRun, { type: 'formula' }>) {
  const height = run.heightEm ?? TASK_CONTENT.formulaHeightEm;
  const ratio = run.width / run.height;
  return {
    width: `${height * ratio}em`,
    verticalAlign:
      run.baselineEm === undefined ? TASK_CONTENT.formulaAlignment : `${run.baselineEm}em`,
  };
}
export function solutionBlocks(solution: Solution): TaskBlock[] {
  const answer = solution.referenceAnswerContent?.length
    ? solution.referenceAnswerContent
    : solution.referenceAnswer
      ? [{ type: 'text' as const, value: solution.referenceAnswer }]
      : [];
  const explanation = solution.referenceContent?.length
    ? solution.referenceContent
    : solution.referenceSolution
      ? [{ type: 'text' as const, value: solution.referenceSolution }]
      : [];
  return [
    ...(answer.length
      ? [{ type: 'text' as const, value: LEARNING_COPY.referenceAnswer }, ...answer]
      : []),
    ...(explanation.length
      ? [{ type: 'text' as const, value: TASK_CONTENT.solutionLabel }, ...explanation]
      : []),
  ];
}
export function solutionInputKey(item: AttemptItem) {
  return `${item.task.taskVersionId}:${item.answerRevision}:${item.submission?.id ?? ''}:${item.submission?.revision ?? ''}`;
}
