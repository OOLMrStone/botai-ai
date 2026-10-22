'use client';

import { useEffect, useState } from 'react';
import { BILLING, BILLING_COPY as C } from '@/config/billing';
import {
  fetchBillingStatus,
  fetchTestPayment,
  refreshTestPayment,
  type BillingPayment,
  type BillingStatus,
} from '@/lib/api/billing';
import { ApiError } from '@/lib/api/client';
import { assertTestPayment, hasTestAccess, isPendingPayment } from '@/lib/billing';
import { finishBillingIntent } from '@/lib/billing-intent';
import { profileResource } from '@/lib/profile-resource';
import { useAuthStore } from '@/stores/auth-store';

export function useBillingPayment(id: string | null) {
  const owner = useAuthStore((state) => state.user?.id ?? '');
  const [payment, setPayment] = useState<BillingPayment | null>(null);
  const [loadedFor, setLoadedFor] = useState<{ id: string; owner: string } | null>(null);
  const [access, setAccess] = useState<BillingStatus | null>(null);
  const [accessFor, setAccessFor] = useState<{ id: string; owner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!id || !owner) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let running = false;
    let stopped = false;

    async function check(refresh: boolean) {
      if (
        running ||
        stopped ||
        controller.signal.aborted ||
        (refresh && document.visibilityState !== 'visible')
      )
        return;
      running = true;
      setChecking(true);
      setExhausted(false);
      try {
        const result = assertTestPayment(
          await (refresh
            ? refreshTestPayment(id!, controller.signal)
            : fetchTestPayment(id!, controller.signal)),
        );
        if (controller.signal.aborted) return;
        setPayment(result);
        setLoadedFor({ id: result.id, owner });
        setError(null);
        try {
          finishBillingIntent(sessionStorage, owner, result);
        } catch {
          /* Серверный статус не зависит от доступности хранилища вкладки. */
        }
        if (hasTestAccess(result)) {
          profileResource.invalidate();
          void profileResource.get().catch(() => undefined);
        }
        if (isPendingPayment(result)) {
          attempts += 1;
          if (attempts < BILLING.pollAttempts)
            timer = setTimeout(() => void check(true), BILLING.pollIntervalMs);
          else {
            stopped = true;
            setExhausted(true);
          }
        } else {
          stopped = true;
          const status = await fetchBillingStatus(controller.signal);
          if (!controller.signal.aborted) {
            setAccess(status);
            setAccessFor({ id: result.id, owner });
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          stopped = true;
          setError(cause instanceof ApiError && cause.status === 404 ? C.notFound : C.statusError);
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) setChecking(false);
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        clearTimeout(timer);
        void check(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void check(revision > 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, owner, revision]);

  return {
    payment: loadedFor?.id === id && loadedFor.owner === owner ? payment : null,
    access: accessFor?.id === id && accessFor.owner === owner ? access : null,
    error: id ? error : C.invalidPayment,
    checking,
    exhausted,
    updateSubscription: (subscription: NonNullable<BillingStatus['subscription']>) =>
      setAccess((previous) =>
        previous?.subscription?.id === subscription.id ? { ...previous, subscription } : previous,
      ),
    retry: () => setRevision((value) => value + 1),
  };
}
