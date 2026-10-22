'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ROUTES } from '@/config/onboarding-steps';
import { useAuthStore } from '@/stores/auth-store';

export function useLogout() {
  const router = useRouter();
  const logoutSession = useAuthStore((state) => state.logout);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const logout = async () => {
    setPending(true);
    setFailed(false);

    try {
      await logoutSession();
      router.replace(ROUTES.login);
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return { logout, pending, failed };
}
