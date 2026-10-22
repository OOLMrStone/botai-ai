'use client';

import { useEffect, useState } from 'react';

import { useAuthStore } from '@/stores/auth-store';

// Витрина читает существующую сессию, не меняя сценарии входа и их моки.
export function useStorefrontSession() {
  const user = useAuthStore((state) => state.user);
  const refresh = useAuthStore((state) => state.refresh);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;
    let active = true;
    void refresh().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [failed, refresh]);

  return { user, failed, retry: () => setFailed(false) };
}
