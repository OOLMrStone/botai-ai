'use client';

import { useEffect, useRef, useState } from 'react';
import { BILLING_COPY as C } from '@/config/billing';
import { cancelTestSubscription, type BillingSubscription } from '@/lib/api/billing';
import { assertBillingSubscription } from '@/lib/billing';
import { useAuthStore } from '@/stores/auth-store';

export function useBillingSubscription(
  subscription: BillingSubscription,
  onChange: (subscription: BillingSubscription) => void,
) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const canCancel = subscription.renewalEnabled || subscription.status === 'pending_initial';

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    if (next) setError(null);
    setOpen(next);
    if (!next) triggerRef.current?.focus();
  };

  const cancel = async () => {
    if (!open || busy.current || !canCancel) return;
    const owner = useAuthStore.getState().user?.id;
    if (!owner) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = assertBillingSubscription(await cancelTestSubscription(subscription.id));
      if (result.id !== subscription.id || result.renewalEnabled) throw new Error(C.cancelError);
      if (active.current && useAuthStore.getState().user?.id === owner) {
        onChange(result);
        setOpen(false);
        triggerRef.current?.focus();
      }
    } catch {
      if (active.current && useAuthStore.getState().user?.id === owner) setError(C.cancelError);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };

  return { open, changeOpen, pending, error, cancel, canCancel, triggerRef, backRef };
}
