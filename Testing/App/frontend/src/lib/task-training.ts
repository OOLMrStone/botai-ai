import type {
  Difficulty,
  TaskCount,
  TaskHistoryStatus,
  TaskStatus,
  TrainingTask,
} from '@/config/tasks';
import { isValidShortAnswer, normalizeShortAnswer } from '@/lib/validation';
import {
  allocateDifficultyCounts,
  difficultiesAt,
  allowsUnratedDifficulty,
} from '@/lib/task-difficulty';

interface SelectTasksInput {
  tasks: TrainingTask[];
  difficulties: Difficulty[];
  count: TaskCount;
  difficultyLevel?: number;
  history: Record<string, TaskHistoryStatus>;
}

interface CheckAnswersInput {
  taskIds: string[];
  answers: Record<string, string>;
  statuses: Record<string, TaskStatus>;
  history: Record<string, TaskHistoryStatus>;
  tasks: TrainingTask[];
}

export function selectTrainingTasks({
  tasks,
  difficulties,
  count,
  difficultyLevel,
  history,
}: SelectTasksInput) {
  const priority = (task: TrainingTask) => {
    const status = history[task.id];
    return status === 'in-progress' ? 0 : status === undefined ? 1 : 2;
  };

  const activeDifficulties =
    difficultyLevel === undefined ? difficulties : difficultiesAt(difficultyLevel);
  const unrated =
    difficultyLevel !== undefined && allowsUnratedDifficulty(difficultyLevel)
      ? tasks.filter((task) => task.difficulty === null).sort((a, b) => priority(a) - priority(b))
      : [];
  const sorted = tasks
    .filter((task) => task.difficulty !== null && activeDifficulties.includes(task.difficulty))
    .sort(
      (a, b) =>
        priority(a) - priority(b) || (a.difficulty ?? Infinity) - (b.difficulty ?? Infinity),
    );

  if (count === 'all' || difficultyLevel === undefined) {
    const available = [...sorted, ...unrated].filter((task) => history[task.id] !== 'correct');
    return count === 'all' ? available : available.slice(0, count);
  }

  const counts = allocateDifficultyCounts(count, difficultyLevel);
  const selected = activeDifficulties.flatMap((difficulty) =>
    sorted.filter((task) => task.difficulty === difficulty).slice(0, counts[difficulty]),
  );
  if (selected.length >= count) return selected.slice(0, count);

  const selectedIds = new Set(selected.map((task) => task.id));
  const remainder = sorted.filter((task) => !selectedIds.has(task.id));
  return [...selected, ...remainder, ...unrated].slice(0, count);
}

export function taskProgress(tasks: TrainingTask[], history: Record<string, TaskHistoryStatus>) {
  if (tasks.length === 0) return 0;
  const correct = tasks.filter((task) => history[task.id] === 'correct').length;
  return Math.round((correct / tasks.length) * 100);
}

export function isTrainingAnswerCorrect(task: TrainingTask, answer: string | undefined) {
  if (!isValidShortAnswer(answer)) return false;

  const normalized = normalizeShortAnswer(answer);
  return task.acceptedAnswers.some((accepted) => normalizeShortAnswer(accepted) === normalized);
}

export function checkTrainingAnswers({
  taskIds,
  answers,
  statuses: previousStatuses,
  history: previousHistory,
  tasks,
}: CheckAnswersInput) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const statuses = { ...previousStatuses };
  const history = { ...previousHistory };

  for (const taskId of taskIds) {
    if ((statuses[taskId] ?? 'unverified') !== 'unverified') continue;
    const task = taskMap.get(taskId);
    const rawAnswer = answers[taskId];
    if (!task || !isValidShortAnswer(rawAnswer)) continue;

    const correct = isTrainingAnswerCorrect(task, rawAnswer);
    const status = correct ? 'correct' : 'incorrect';
    statuses[taskId] = status;
    history[taskId] =
      status === 'correct' || history[taskId] === 'correct' ? 'correct' : 'in-progress';
  }

  return { statuses, history };
}

export function resolveTrainingTasks(taskIds: string[], tasks: TrainingTask[]) {
  if (taskIds.length === 0) return null;

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const sessionTasks = taskIds.flatMap((taskId) => {
    const task = taskMap.get(taskId);
    return task ? [task] : [];
  });

  return sessionTasks.length === taskIds.length ? sessionTasks : null;
}
