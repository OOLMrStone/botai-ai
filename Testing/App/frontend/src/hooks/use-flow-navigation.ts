'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import {
  nextOnboardingPath,
  nextRegisterSlug,
  registerPath,
  ROUTES,
  type OnboardingSlug,
  type RegisterSlug,
} from '@/config/onboarding-steps';

interface GoNextOptions {
  replace?: boolean;
}

// Экран называет себя один раз: хук префетчит следующий шаг (переход без паузы),
// а goNext() уводит в уже прогретый роут. Порядок берётся из конфига.
function useStepFlow(nextHref: string) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch(nextHref);
  }, [router, nextHref]);

  const goNext = ({ replace = false }: GoNextOptions = {}) => {
    if (replace) router.replace(nextHref);
    else router.push(nextHref);
  };

  return { goNext };
}

export function useOnboardingFlow(current: OnboardingSlug) {
  return useStepFlow(nextOnboardingPath(current));
}

export function useRegisterFlow(current: RegisterSlug) {
  const next = nextRegisterSlug(current);
  return useStepFlow(next ? registerPath(next) : ROUTES.done);
}
