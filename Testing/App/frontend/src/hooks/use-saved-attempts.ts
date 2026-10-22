'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type AttemptFilter } from '@/config/attempts';
import { LEARNING_ROUTES } from '@/config/integration';
import { ROUTES } from '@/config/onboarding-steps';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  attemptCardContent,
  attemptEmptyContent,
  filterAttempts,
  recentAttempts,
} from '@/lib/attempt-list';
import { examsResource, historyResource } from '@/lib/learning-resources';

export function useSavedAttempts(history: boolean) {
  const { data, failed, retry } = useAsyncData(historyResource);
  const exams = useAsyncData(examsResource).data;
  const [filter, setFilter] = useState<AttemptFilter>('all');
  const router = useRouter();
  const visible = filterAttempts(recentAttempts(data), history ? filter : 'all');

  return {
    cards: visible?.map((attempt) => ({ attempt, content: attemptCardContent(attempt, exams) })),
    failed,
    retry,
    filter,
    setFilter,
    empty: attemptEmptyContent(history, filter),
    hasAttempts: Boolean(data?.length),
    openAttempt: (id: string) => router.push(LEARNING_ROUTES.attempt(id)),
    openCatalog: () => router.push(ROUTES.tasks),
    openHistory: () => router.push(LEARNING_ROUTES.history),
  };
}
