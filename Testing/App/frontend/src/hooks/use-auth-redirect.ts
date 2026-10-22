'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthSession } from '@/hooks/use-auth-session';
import { rememberAuthReturn } from '@/lib/auth-return';

export function useAuthRedirect(routes: { anonymous: string; returnTo?: string }) {
  const router = useRouter();
  const session = useAuthSession();
  const destination = session.status === 'anonymous' ? routes.anonymous : undefined;

  useEffect(() => {
    if (destination) {
      if (routes.returnTo) rememberAuthReturn(routes.returnTo);
      router.replace(destination);
    }
  }, [destination, router, routes.returnTo]);

  return session;
}
