'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestErrorMessage } from '@/lib/api/client';
import { useAuthSession } from '@/hooks/use-auth-session';
import { ONBOARDING_DESTINATION, ROUTES } from '@/config/onboarding-steps';
import { IS_MOCK_API } from '@/config/env';
import { LEARNING_COPY as C } from '@/config/integration';
import { saveOnboarding } from '@/lib/api/onboarding';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useAuthStore } from '@/stores/auth-store';

export function useCompleteOnboarding() {
  const router = useRouter();
  const session = useAuthSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    if (saving || session.status === 'unknown' || session.status === 'error') return;
    const user = useAuthStore.getState().user;
    if (!user) {
      useOnboardingStore.getState().requireProfileSave();
      router.push(ONBOARDING_DESTINATION);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const choices = useOnboardingStore.getState();
      await saveOnboarding({
        goal: choices.goal,
        level: choices.level,
        dailyGoalMinutes: choices.dailyGoalMinutes,
        notificationsEnabled: choices.notificationsEnabled,
      });
      if (useAuthStore.getState().user?.id !== user.id) return;
      choices.reset();
      router.push(ROUTES.home);
    } catch (cause) {
      setError(requestErrorMessage(cause, C.saveError));
    } finally {
      setSaving(false);
    }
  };
  const start = () => (IS_MOCK_API ? router.push(ROUTES.lesson) : void finish());
  return { session, pending: saving || session.status === 'unknown', error, finish, start };
}
