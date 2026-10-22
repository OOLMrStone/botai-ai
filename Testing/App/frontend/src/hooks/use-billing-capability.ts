'use client';

import { useEffect, useState } from 'react';
import { fetchBillingStatus } from '@/lib/api/billing';
import { useAuthStore } from '@/stores/auth-store';

export function useBillingCapability() {
  const owner = useAuthStore((state) => state.user?.id ?? '');
  const [capability, setCapability] = useState<{ owner: string; enabled: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (owner)
      void fetchBillingStatus(controller.signal)
        .then((status) => {
          if (!controller.signal.aborted)
            setCapability({
              owner,
              enabled: status?.mode === 'test' && status.testOnly === true,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted) setCapability({ owner, enabled: false });
        });
    return () => controller.abort();
  }, [owner]);
  return capability?.owner === owner && capability.enabled;
}
