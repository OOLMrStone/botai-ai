import { clearAttemptDrafts } from '@/lib/attempt-drafts';
import { INTEGRATION } from '@/config/integration';
import { setResourceOwner } from '@/lib/cached-resource';
import { useTasksStore } from '@/stores/tasks-store';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useProfileStore } from '@/stores/profile-store';
let owner: string | null = null;
export function syncAccountState(next: string | null) {
  if (owner === next) return;
  if (owner !== null) useOnboardingStore.getState().reset();
  owner = next;
  clearAttemptDrafts();
  setResourceOwner(next);
  useTasksStore.getState().reset();
  useProfileStore.getState().reset();
  if (typeof window !== 'undefined')
    INTEGRATION.legacyKeys.forEach((key) => window.localStorage.removeItem(key));
}
