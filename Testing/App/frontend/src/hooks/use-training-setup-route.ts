'use client';

import { useSearchParams } from 'next/navigation';

import { TRAINING_SETUP } from '@/config/tasks';
import type { Task } from '@/lib/api/learning-types';
import { trainingSetupExamNumber } from '@/lib/training-setup';

export function useTrainingSetupRoute(tasks: Task[] | null) {
  const search = useSearchParams();

  return trainingSetupExamNumber(search.get(TRAINING_SETUP.examNumberParam), tasks ?? []);
}
