import { cachedResource } from '@/lib/cached-resource';
import {
  collectPages,
  fetchAllTasks,
  fetchCatalog,
  fetchExams,
  fetchFavorites,
  fetchHistory,
  fetchUnfinished,
} from '@/lib/api/learning';
export const catalogResource = cachedResource(fetchCatalog);
export const tasksResource = cachedResource(fetchAllTasks);
export const examsResource = cachedResource(() => collectPages(fetchExams));
export const favoritesResource = cachedResource(() => collectPages(fetchFavorites));
export const historyResource = cachedResource(() => collectPages(fetchHistory));
export const unfinishedResource = cachedResource(() => collectPages(fetchUnfinished));
export function invalidateAttempts() {
  unfinishedResource.invalidate();
  historyResource.invalidate();
  examsResource.invalidate();
}
