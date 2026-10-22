'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { CachedResource } from '@/lib/cached-resource';
export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}
export function useAsyncData<T>(resource: CachedResource<T>): AsyncData<T> {
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => {
    if (state.data === null && !state.error && !state.loading)
      void resource.get().catch(() => undefined);
  }, [resource, state]);
  return {
    data: state.data,
    loading: state.loading || (state.data === null && !state.error),
    failed: Boolean(state.error),
    retry: resource.invalidate,
  };
}
