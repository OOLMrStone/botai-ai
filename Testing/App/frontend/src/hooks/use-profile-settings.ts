'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestErrorMessage } from '@/lib/api/client';
import { useProfile } from '@/hooks/use-profile';
import { updateProfileSettings } from '@/lib/api/profile';
import { invalidateResources } from '@/lib/cached-resource';
import { useProfileStore } from '@/stores/profile-store';
import { useAuthStore } from '@/stores/auth-store';
import { LEARNING_COPY as C } from '@/config/integration';

export function useProfileSettings() {
  const router = useRouter();
  const profile = useProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [levelDraft, setLevelDraft] = useState<string | null>(null);
  const [minutesDraft, setMinutesDraft] = useState<number | null>(null);
  const data = profile.data;
  const name = nameDraft ?? data?.displayName ?? '';
  const goalId = goalDraft ?? data?.goalId ?? '';
  const levelId = levelDraft ?? data?.levelId ?? '';
  const minutes = minutesDraft ?? data?.dailyGoalMinutes;
  const save = async () => {
    if (!data || minutes === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateProfileSettings({
        name: name.trim() || null,
        goalId: goalId || null,
        levelId: levelId || null,
        dailyGoalMinutes: minutes,
      });
      useProfileStore.getState().update({
        name: next.displayName,
        goalId: next.goalId,
        dailyGoalMinutes: next.dailyGoalMinutes,
      });
      const user = useAuthStore.getState().user;
      if (user?.id === next.id)
        useAuthStore.getState().setUser({ ...user, displayName: next.displayName });
      invalidateResources();
      router.back();
    } catch (cause) {
      setError(requestErrorMessage(cause, C.saveError));
    } finally {
      setSaving(false);
    }
  };
  return {
    profile,
    name,
    goalId,
    levelId,
    minutes,
    saving,
    error,
    setNameDraft,
    setGoalDraft,
    setLevelDraft,
    setMinutesDraft,
    save,
    back: () => router.back(),
  };
}
