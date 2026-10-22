'use client';

import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

import { COPY, ROUTES } from '@/config/onboarding-steps';
import { useAuthSession } from '@/hooks/use-auth-session';
import { verifyEmail } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { LEARNING_COPY as C } from '@/config/integration';

type VerificationStatus = 'pending' | 'success' | 'invalid' | 'error';

export function useEmailVerification() {
  const token = useSearchParams().get('token')?.trim();
  const { status: sessionStatus, retry: retrySession } = useAuthSession();
  const user = useAuthStore((state) => state.user);
  const [verification, setVerification] = useState<{
    token: string;
    status: VerificationStatus;
  } | null>(null);
  const busy = useRef(false);
  const status = !token ? 'missing' : verification?.token === token ? verification.status : 'ready';
  const pending = status === 'pending';
  const done = status === 'success';
  const canConfirm = status === 'ready' || status === 'error';

  const confirm = async () => {
    if (!token || busy.current || !canConfirm) return;
    busy.current = true;
    setVerification({ token, status: 'pending' });

    try {
      await verifyEmail(token);
      setVerification({ token, status: 'success' });
      // Ссылка уже использована: сбой чтения сессии не отменяет подтверждение.
      await useAuthStore
        .getState()
        .refresh()
        .catch(() => undefined);
    } catch (cause) {
      setVerification({
        token,
        status: cause instanceof ApiError && cause.code === 'invalid_code' ? 'invalid' : 'error',
      });
    } finally {
      busy.current = false;
    }
  };

  const copy = {
    missing: { title: C.verifyMissingTitle, description: C.verifyMissingDescription },
    ready: { title: C.verifyTitle, description: C.verifyDescription },
    pending: { title: C.verifyPending, description: C.verifyPendingDescription },
    success: { title: C.verified, description: C.verifySuccessDescription },
    invalid: { title: C.verifyInvalid, description: C.verifyInvalidDescription },
    error: { title: C.verifyTitle, description: C.verifyDescription },
  }[status];

  return {
    ...copy,
    pending,
    done,
    invalid: status === 'invalid',
    canConfirm,
    confirm,
    error: status === 'error' ? C.verifyError : null,
    confirmLabel: status === 'error' ? C.retry : C.verifyAction,
    returnHref: user ? ROUTES.settings : ROUTES.login,
    returnLabel:
      sessionStatus === 'unknown'
        ? COPY.profile.loading
        : user
          ? C.verifyBackSettings
          : C.verifyBackLogin,
    returnPending: pending || sessionStatus === 'unknown',
    sessionFailed: sessionStatus === 'error',
    retrySession,
  };
}
