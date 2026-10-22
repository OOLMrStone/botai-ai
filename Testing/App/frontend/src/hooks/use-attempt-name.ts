'use client';

import { useRef, useState } from 'react';
import { ATTEMPT_COPY as C } from '@/config/attempts';
import { LEARNING_COPY } from '@/config/integration';
import { requestErrorMessage } from '@/lib/api/client';
import { fetchAttempt, patchAttempt } from '@/lib/api/learning';
import type { Attempt } from '@/lib/api/learning-types';
import { historyResource, unfinishedResource } from '@/lib/learning-resources';
import { useAuthStore } from '@/stores/auth-store';

export function useAttemptName(attempt: Attempt, title: string) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    if (next) {
      setName(title);
      setError(null);
    }
    setOpen(next);
  };

  const save = async () => {
    if (busy.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(C.nameRequired);
      return;
    }

    busy.current = true;
    setSaving(true);
    setError(null);
    const owner = useAuthStore.getState().user?.id;
    try {
      const latest = await fetchAttempt(attempt.id);
      const updated = await patchAttempt(attempt.id, { revision: latest.revision, title: trimmed });
      if (useAuthStore.getState().user?.id !== owner) return;

      for (const resource of [historyResource, unfinishedResource]) {
        const cached = resource.peek();
        if (cached) {
          resource.set(cached.map((item) => (item.id === updated.id ? updated : item)));
        }
      }
      setOpen(false);
    } catch (cause) {
      setError(requestErrorMessage(cause, LEARNING_COPY.saveError));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return { open, changeOpen, name, setName, saving, error, save, inputRef };
}
