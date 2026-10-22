'use client';
import { useMemo, useState } from 'react';
import { cachedResource } from '@/lib/cached-resource';
import { useAsyncData } from '@/hooks/use-async-data';
import { fetchAdminDetail, fetchAdminSubmissions } from '@/lib/api/admin';
import type { AdminFilters } from '@/lib/api/admin';
export function useAdminSubmissions() {
  const [draft, setDraft] = useState<AdminFilters>({});
  const [filters, setFilters] = useState<AdminFilters>({});
  const resource = useMemo(() => cachedResource(() => fetchAdminSubmissions(filters)), [filters]);
  const state = useAsyncData(resource);
  return {
    ...state,
    draft,
    change: (key: keyof AdminFilters, value: string) =>
      setDraft((current) => ({ ...current, [key]: value })),
    apply: () =>
      setFilters({
        ...draft,
        from: draft.from ? new Date(draft.from).toISOString() : undefined,
        to: draft.to ? new Date(draft.to).toISOString() : undefined,
        cursor: undefined,
      }),
    next: () =>
      setFilters((current) => ({ ...current, cursor: state.data?.nextCursor ?? undefined })),
  };
}
export function useAdminDetail(id: string) {
  const resource = useMemo(() => cachedResource(() => fetchAdminDetail(id)), [id]);
  return useAsyncData(resource);
}
