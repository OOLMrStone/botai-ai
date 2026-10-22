'use client';
import { createClientId } from '@/lib/client-id';

import { useCallback, useEffect, useRef } from 'react';
import { IS_MOCK_API } from '@/config/env';
import { recordAttemptExit } from '@/lib/api/learning';
import { invalidateAttempts } from '@/lib/learning-resources';

export function useAttemptExit(id: string, enabled: boolean) {
  const controller = useRef<{ id: string; recordExit: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!enabled || IS_MOCK_API) return;
    const newVisit = () => {
      const eventId = createClientId();
      let recorded = false;
      let inflight: Promise<void> | null = null;
      return () => {
        if (recorded) return Promise.resolve();
        if (!inflight) {
          inflight = recordAttemptExit(id, eventId)
            .then(() => {
              recorded = true;
              invalidateAttempts();
            })
            .finally(() => {
              inflight = null;
            });
        }
        return inflight;
      };
    };
    let recordVisit = newVisit();
    const visit = { id, recordExit: () => recordVisit() };
    controller.current = visit;
    const leave = () => void visit.recordExit().catch(() => undefined);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) recordVisit = newVisit();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      if (controller.current === visit) controller.current = null;
      // Strict Mode повторяет эффект без выхода со страницы; реальный переход сохраняем.
      queueMicrotask(() => {
        if (controller.current?.id !== id) leave();
      });
    };
  }, [id, enabled]);

  const recordExit = useCallback(() => controller.current?.recordExit() ?? Promise.resolve(), []);
  return { recordExit };
}
