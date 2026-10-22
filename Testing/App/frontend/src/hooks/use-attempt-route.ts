'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ROUTES } from '@/config/onboarding-steps';
import { useRequireAuth } from '@/hooks/use-require-auth';
export function useAttemptRoute() {
  const auth = useRequireAuth();
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get('attempt');
  useEffect(() => {
    if (auth.status === 'authenticated' && !id) router.replace(ROUTES.home);
  }, [auth.status, id, router]);
  return { auth, id };
}
