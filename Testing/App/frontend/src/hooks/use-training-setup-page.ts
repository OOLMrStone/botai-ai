'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { INTEGRATION } from '@/config/integration';
import { ROUTES } from '@/config/onboarding-steps';
import { TASK_COPY, TASK_DIFFICULTY_SLIDER, TRAINING_SETUP } from '@/config/tasks';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTrainingLaunch } from '@/hooks/use-training-launch';
import type { Task, TrainingSelection } from '@/lib/api/learning-types';
import { catalogResource } from '@/lib/learning-resources';
import { difficultyLabelKey, clampDifficultyLevel } from '@/lib/task-difficulty';
import {
  availableTrainingTasks,
  clampTrainingCount,
  trainingNumberOptions,
} from '@/lib/training-setup';

export function useTrainingSetupPage(tasks: Task[], fixedExamNumber: number | null = null) {
  const router = useRouter();
  const catalog = useAsyncData(catalogResource);
  const launch = useTrainingLaunch();
  const canChooseNumbers = fixedExamNumber === null;
  const pickerToggleRef = useRef<HTMLElement>(null);
  const [numbersOpen, setNumbersOpen] = useState(canChooseNumbers);
  const [selections, setSelections] = useState<TrainingSelection[]>(
    fixedExamNumber !== null
      ? [
          {
            examNumber: fixedExamNumber,
            count: clampTrainingCount(
              TRAINING_SETUP.defaultCount,
              availableTrainingTasks(
                tasks,
                { examNumber: fixedExamNumber },
                TASK_DIFFICULTY_SLIDER.defaultValue,
              ),
            ),
          },
        ]
      : [],
  );
  const [difficultyLevel, setDifficultyLevel] = useState<number>(
    TASK_DIFFICULTY_SLIDER.defaultValue,
  );
  const available = (selection: TrainingSelection, level = difficultyLevel) =>
    availableTrainingTasks(tasks, selection, level);
  const toggle = (examNumber: number) => {
    if (!canChooseNumbers) return;

    const removingLast = selections.length === 1 && selections[0].examNumber === examNumber;
    if (!selections.length || removingLast) {
      pickerToggleRef.current?.focus();
      setNumbersOpen(removingLast);
    }
    const count = clampTrainingCount(
      TRAINING_SETUP.defaultCount,
      available({ examNumber, count: TRAINING_SETUP.defaultCount }),
    );
    setSelections((current) =>
      current.some((selection) => selection.examNumber === examNumber)
        ? current.filter((selection) => selection.examNumber !== examNumber)
        : [...current, { examNumber, count }],
    );
  };
  const update = (examNumber: number, patch: Partial<Omit<TrainingSelection, 'examNumber'>>) =>
    setSelections((current) =>
      current.map((selection) =>
        selection.examNumber === examNumber ? { ...selection, ...patch } : selection,
      ),
    );
  const toggleTopic = (examNumber: number, topicId?: string) =>
    setSelections((current) =>
      current.map((selection) => {
        if (selection.examNumber !== examNumber) return selection;
        const selected = selection.topicIds ?? [];
        const topicIds = !topicId
          ? []
          : selected.includes(topicId)
            ? selected.filter((id) => id !== topicId)
            : [...selected, topicId];
        return { ...selection, topicIds };
      }),
    );
  const changeDifficultyLevel = (nextLevel: number) => {
    const level = clampDifficultyLevel(nextLevel);
    setDifficultyLevel(level);
  };
  const total = selections.reduce((sum, selection) => sum + selection.count, 0);
  const shortage = selections.some((selection) => selection.count > available(selection));
  const overLimit = total > INTEGRATION.maxTasks;
  const canStart =
    Boolean(catalog.data) &&
    !launch.busy &&
    !shortage &&
    !overLimit &&
    total > 0 &&
    selections.every(
      (selection) =>
        Number.isInteger(selection.count) &&
        selection.count >= TRAINING_SETUP.minCount &&
        selection.count <= INTEGRATION.maxPerNumber,
    );
  const startDisabledReason =
    launch.busy || !catalog.data
      ? undefined
      : !selections.length
        ? TASK_COPY.setup.chooseNumbers
        : overLimit
          ? TASK_COPY.setup.tooMany(INTEGRATION.maxTasks)
          : shortage
            ? TASK_COPY.setup.insufficient
            : undefined;
  const start = async () => {
    if (!canStart || !catalog.data) return;
    await launch.start({
      formatId: catalog.data.format.id,
      selections,
      difficultyPreference: difficultyLevel,
      source: 'catalog',
    });
  };

  return {
    catalog,
    canChooseNumbers,
    numbers: trainingNumberOptions(catalog.data?.numbers ?? [], tasks, selections, difficultyLevel),
    selections,
    numbersOpen,
    setNumbersOpen,
    pickerToggleRef,
    toggle,
    toggleTopic,
    update,
    available,
    total,
    shortage,
    overLimit,
    canStart,
    startDisabledReason,
    difficultyLabelKey: difficultyLabelKey(difficultyLevel),
    difficultyLevel,
    setDifficultyLevel: changeDifficultyLevel,
    busy: launch.busy,
    error: launch.error,
    start,
    close: () => router.push(ROUTES.tasks),
  };
}
