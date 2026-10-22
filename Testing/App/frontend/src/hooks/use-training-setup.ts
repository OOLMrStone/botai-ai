'use client';

import { useState } from 'react';

import {
  ALL_TASK_TOPICS,
  TASK_COPY,
  TASK_DIFFICULTY_SLIDER,
  type TaskCount,
  type TrainingSettings,
  type TrainingTask,
} from '@/config/tasks';
import {
  difficultiesAt,
  isDifficultyEligible,
  difficultyLabelKey,
  difficultyLevelFromSelection,
} from '@/lib/task-difficulty';

export function useTrainingSetup(
  initial: TrainingSettings,
  tasks: TrainingTask[],
  topics: readonly { id: string; title: string }[] = [],
) {
  const [topicId, setTopicId] = useState<string>(ALL_TASK_TOPICS);
  const selectedTasks =
    topicId === ALL_TASK_TOPICS ? tasks : tasks.filter((task) => task.topicIds.includes(topicId));
  const topicOptions = [
    { id: ALL_TASK_TOPICS, title: TASK_COPY.allTasks },
    ...topics.filter((topic) => tasks.some((task) => task.topicIds.includes(topic.id))),
  ];
  const initialLevel =
    initial.difficultyLevel ?? difficultyLevelFromSelection(initial.difficulties);
  const [settings, setSettings] = useState<TrainingSettings>({
    ...initial,
    difficultyLevel: initialLevel,
    difficulties: difficultiesAt(initialLevel),
  });

  const setCount = (count: TaskCount) => setSettings((current) => ({ ...current, count }));
  const setDifficultyLevel = (difficultyLevel: number) =>
    setSettings((current) => ({
      ...current,
      difficultyLevel,
      difficulties: difficultiesAt(difficultyLevel),
    }));

  const difficultyLevel = settings.difficultyLevel ?? TASK_DIFFICULTY_SLIDER.defaultValue;
  const canStart = selectedTasks.some((task) =>
    isDifficultyEligible(task.difficulty, difficultyLevel),
  );

  return {
    topicId,
    setTopicId,
    selectedTasks,
    topicOptions,
    settings,
    difficultyLevel,
    difficultyLabelKey: difficultyLabelKey(difficultyLevel),
    canStart,
    setCount,
    setDifficultyLevel,
  };
}
