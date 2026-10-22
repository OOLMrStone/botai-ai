'use client';

import { useEffect, useRef, useState } from 'react';
import { ATTEMPT_COPY as C } from '@/config/attempts';
import { requestErrorMessage } from '@/lib/api/client';
import { deleteAttempt } from '@/lib/api/learning';
import type { Attempt } from '@/lib/api/learning-types';
import { forgetAttemptDraft } from '@/lib/attempt-drafts';
import { invalidateAttempts } from '@/lib/learning-resources';
import { useAuthStore } from '@/stores/auth-store';
import { useTasksStore } from '@/stores/tasks-store';

export function useAttemptDelete(attempt: Attempt) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
  };

  const remove = async () => {
    if (!open || busy.current) return;
    const owner = useAuthStore.getState().user?.id;
    busy.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deleteAttempt(attempt.id);
      if (useAuthStore.getState().user?.id !== owner) return;

      forgetAttemptDraft(attempt.id);
      useTasksStore.getState().resetTaskProgress(attempt.items.map((item) => item.id));
      if (active.current) setOpen(false);
      invalidateAttempts();
    } catch (cause) {
      if (active.current && useAuthStore.getState().user?.id === owner)
        setError(requestErrorMessage(cause, C.deleteError));
    } finally {
      busy.current = false;
      if (active.current) setDeleting(false);
    }
  };

  return { open, changeOpen, deleting, error, remove, cancelRef };
}
