'use client';
import { useState } from 'react';
import { requestErrorMessage } from '@/lib/api/client';
import { useAsyncData } from '@/hooks/use-async-data';
import { profileResource } from '@/lib/profile-resource';
import { requestEmailVerification } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/auth-store';
import { removeAvatar, uploadAvatar } from '@/lib/api/profile';
import { invalidateResources } from '@/lib/cached-resource';
import { LEARNING_COPY as C } from '@/config/integration';
export function useProfile() {
  const state = useAsyncData(profileResource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const verify = async () => {
    const user = useAuthStore.getState().user;
    if (!user || verificationBusy) return;
    setVerificationBusy(true);
    setError(null);
    try {
      await requestEmailVerification(user.email);
      if (useAuthStore.getState().user?.id === user.id) setVerificationSent(true);
    } catch (cause) {
      setError(requestErrorMessage(cause, C.saveError));
    } finally {
      setVerificationBusy(false);
    }
  };
  const avatar = async (file?: File) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await (file ? uploadAvatar(file) : removeAvatar());
      invalidateResources();
    } catch (cause) {
      setError(requestErrorMessage(cause, C.saveError));
    } finally {
      setBusy(false);
    }
  };
  const addAvatar = (files: File[]) => {
    if (files[0]) void avatar(files[0]);
  };

  return { ...state, busy, error, avatar, addAvatar, verify, verificationBusy, verificationSent };
}
