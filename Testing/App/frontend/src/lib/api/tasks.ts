import { fetchAllTasks, setFavorite } from '@/lib/api/learning';
export const fetchTasks = fetchAllTasks;
export async function saveFavoriteTask(taskId: string, favorite: boolean) {
  await setFavorite(taskId, favorite);
}
