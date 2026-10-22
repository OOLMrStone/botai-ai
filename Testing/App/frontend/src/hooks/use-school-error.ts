'use client';

import { useCallback } from 'react';
import { ApiError } from '@/lib/api/client';
import { schoolErrorMessage } from '@/lib/api/school';
import { useSchoolStore } from '@/stores/school-store';

export function useSchoolError() {
  return useCallback((cause: unknown) => {
    const store = useSchoolStore.getState();
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) store.reset();
    else if (cause instanceof ApiError && cause.status === 404) {
      store.setAssignment(null);
      store.setAssignments([]);
    }
    store.setError(schoolErrorMessage(cause));
  }, []);
}
