'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { trainingSetupPath } from '@/config/tasks';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTrainingLaunch } from '@/hooks/use-training-launch';
import type { Task } from '@/lib/api/learning-types';
import { catalogResource, favoritesResource } from '@/lib/learning-resources';
import { favoriteTrainingBatch } from '@/lib/favorite-training';
import { useTasksStore } from '@/stores/tasks-store';

export function useTaskCatalog(tasks: Task[]) {
  const router = useRouter();
  const view = useTasksStore((state) => state.view);
  const setView = useTasksStore((state) => state.setView);
  const catalog = useAsyncData(catalogResource);
  const favorites = useAsyncData(favoritesResource);
  const launch = useTrainingLaunch();
  const openingSetup = useRef(false);
  const [navigating, setNavigating] = useState(false);
  const [openingNumber, setOpeningNumber] = useState<number | null>(null);
  const numbers = (catalog.data?.numbers ?? [])
    .filter((item) => (view === 'part-1' ? item.part === 1 : item.part === 2))
    .map((number) => ({
      number,
      tasks: tasks.filter((task) => task.examNumber === number.examNumber),
    }));

  const openSetup = (examNumber?: number) => {
    if (openingSetup.current || launch.busy) return;

    openingSetup.current = true;
    setNavigating(true);
    setOpeningNumber(examNumber ?? null);
    router.push(trainingSetupPath(examNumber));
  };
  const openFavorites = async (selectedTasks: Task[]) => {
    if (!selectedTasks.length || !catalog.data) return;

    await launch.start({
      formatId: catalog.data.format.id,
      selections: [],
      source: 'favorites',
      taskIds: favoriteTrainingBatch(selectedTasks).tasks.map((task) => task.id),
    });
  };

  return {
    view,
    setView,
    numbers,
    favoriteTasks: favorites.data,
    openSetup: () => openSetup(),
    openNumber: (examNumber: number) => openSetup(examNumber),
    openFavorites,
    catalog,
    favorites,
    openingNumber,
    busy: launch.busy || navigating,
    error: launch.error,
  };
}
