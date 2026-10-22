import { INTEGRATION } from '@/config/integration';
import { TASK_COUNT_OPTIONS, TRAINING_SETUP } from '@/config/tasks';
import type { CatalogNumber, Task, TrainingSelection } from '@/lib/api/learning-types';
import { isDifficultyEligible } from '@/lib/task-difficulty';

export function trainingSetupExamNumber(
  value: string | null,
  tasks: readonly Pick<Task, 'examNumber'>[],
) {
  const examNumber = Number(value);

  return Number.isInteger(examNumber) && tasks.some((task) => task.examNumber === examNumber)
    ? examNumber
    : null;
}

export function availableTrainingTasks(
  tasks: Task[],
  selection: Pick<TrainingSelection, 'examNumber' | 'topicIds'>,
  level: number,
) {
  return tasks.filter(
    (task) =>
      task.examNumber === selection.examNumber &&
      isDifficultyEligible(task.difficulty, level) &&
      (!selection.topicIds?.length || selection.topicIds.some((id) => task.topicIds.includes(id))),
  ).length;
}

export function clampTrainingCount(count: number, available: number) {
  return Math.max(TRAINING_SETUP.minCount, Math.min(count, available, INTEGRATION.maxPerNumber));
}

export function trainingCountOptions(available: number, count: number) {
  const options: { count: number; disabled: boolean }[] = TASK_COUNT_OPTIONS.map((option) => ({
    count: option,
    disabled: option > available,
  }));
  if (!TASK_COUNT_OPTIONS.some((option) => option === count)) {
    const nextPreset = options.findIndex((option) => option.count > count);
    const index = nextPreset === -1 ? options.length - 1 : nextPreset;
    options[index] = { count, disabled: count > available };
  }
  return options;
}

export function trainingNumberOptions(
  numbers: CatalogNumber[],
  tasks: Task[],
  selections: TrainingSelection[],
  level: number,
) {
  return numbers.map((number) => {
    const selection = selections.find((item) => item.examNumber === number.examNumber);
    const available = availableTrainingTasks(tasks, selection ?? number, level);
    return {
      ...number,
      selection,
      available,
      adjustmentCount:
        selection && selection.count > available && available > 0
          ? Math.min(available, INTEGRATION.maxPerNumber)
          : null,
      countOptions: selection ? trainingCountOptions(available, selection.count) : [],
      topics: number.topics.map((topic) => ({
        ...topic,
        available: availableTrainingTasks(tasks, { ...number, topicIds: [topic.id] }, level),
        selected: Boolean(selection?.topicIds?.includes(topic.id)),
      })),
    };
  });
}

export type TrainingNumberOption = ReturnType<typeof trainingNumberOptions>[number];
