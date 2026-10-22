'use client';

import { useState } from 'react';

import { EXPERIMENTAL } from '@/config/experimental';
import { EXPERIMENTAL_QUEUE, type ExperimentalQueueSort } from '@/config/experimental-workspace';
import { getExperimentalQueue } from '@/lib/experimental-queue';

export function useExperimentalQueue(onOpenStudent: (id: string) => void) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ExperimentalQueueSort>(EXPERIMENTAL_QUEUE.defaultSort);
  const students = getExperimentalQueue(query, sort);

  const changeSort = (value: string) => {
    const option = EXPERIMENTAL_QUEUE.sortOptions.find((option) => option.id === value);
    if (option) setSort(option.id);
  };

  return {
    query,
    sort,
    students,
    setQuery,
    changeSort,
    resetSearch: () => setQuery(''),
    startReview: () => onOpenStudent(EXPERIMENTAL.studentId),
  };
}
