'use client';
import { createClientId } from '@/lib/client-id';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LEARNING_COPY, LEARNING_ROUTES } from '@/config/integration';
import { createTraining } from '@/lib/api/learning';
import type { TrainingRequest } from '@/lib/api/learning-types';
import { invalidateAttempts } from '@/lib/learning-resources';

export function useTrainingLaunch() {
  const router = useRouter();
  const pending = useRef(false);
  const active = useRef(true);
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const start = async (request: TrainingRequest) => {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setError(null);
    const payload = JSON.stringify(request);
    if (requestKey.current?.payload !== payload) {
      requestKey.current = { payload, key: createClientId() };
    }

    try {
      const attempt = await createTraining(request, requestKey.current.key);
      invalidateAttempts();
      if (!active.current) return;
      router.push(LEARNING_ROUTES.attempt(attempt.id));
    } catch (cause) {
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : LEARNING_COPY.saveError);
      pending.current = false;
      setBusy(false);
    }
  };

  return { start, busy, error };
}
