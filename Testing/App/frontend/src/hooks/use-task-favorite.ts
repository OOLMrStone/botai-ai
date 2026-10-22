'use client';
import { useState } from 'react';
import { saveFavoriteTask } from '@/lib/api/tasks';
import { favoritesResource, tasksResource } from '@/lib/learning-resources';
import { useTasksStore } from '@/stores/tasks-store';
import { LEARNING_COPY as C } from '@/config/integration';
export function useTaskFavorite(taskId: string, initial = false) {
  const favorites = useTasksStore((state) => state.favorites);
  const [override, setOverride] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const favorite = override ?? (initial || favorites.includes(taskId));
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveFavoriteTask(taskId, !favorite);
      setOverride(!favorite);
      favoritesResource.invalidate();
      tasksResource.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : C.favoriteError);
    } finally {
      setSaving(false);
    }
  };
  return { favorite, saving, error, toggle };
}
