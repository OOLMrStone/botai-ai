'use client';

import type { DailyTask } from '@/config/daily-tasks';
import { useAsyncData, type AsyncData } from '@/hooks/use-async-data';
import { fetchDailyTask } from '@/lib/api/daily-task';
import { cachedResource } from '@/lib/cached-resource';

const dailyTaskResource = cachedResource(fetchDailyTask);

export interface DailyTaskState extends Omit<AsyncData<DailyTask>, 'data'> {
  task: DailyTask | null;
}

// Задача дня для хаба.
export function useDailyTask(): DailyTaskState {
  const { data, loading, failed, retry } = useAsyncData(dailyTaskResource);

  return { task: data, loading, failed, retry };
}
