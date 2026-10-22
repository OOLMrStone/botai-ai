'use client';

import { usePathname, useRouter } from 'next/navigation';

import { flowProgress } from '@/lib/flow-progress';

export function useFlowHeader(steps: readonly string[]) {
  const pathname = usePathname();
  const router = useRouter();

  return {
    progress: flowProgress(pathname, steps),
    goBack: () => router.back(),
  };
}
