'use client';

import { useCallback, useEffect } from 'react';

import { useAuthStore } from '@/stores/auth-store';

export function useAuthSession() {
  const status = useAuthStore((state) => state.status);
  const refresh = useAuthStore((state) => state.refresh);
  const retry = useCallback(() => {
    // Ошибка уже записана в стор и показана общим экраном с повтором.
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (status === 'unknown') retry();
  }, [status, retry]);

  return { status, retry };
}
