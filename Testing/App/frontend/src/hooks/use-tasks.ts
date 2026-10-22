'use client';
import { useAsyncData } from '@/hooks/use-async-data';
import { tasksResource } from '@/lib/learning-resources';
export function useTasks() {
  const state = useAsyncData(tasksResource);
  return { tasks: state.data, failed: state.failed, retry: state.retry };
}
