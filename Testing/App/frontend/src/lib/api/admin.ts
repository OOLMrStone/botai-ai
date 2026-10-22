import { apiFetch } from '@/lib/api/client';
import type { Page, Submission } from '@/lib/api/learning-types';
export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
}
export interface AdminSummary extends Pick<
  Submission,
  | 'id'
  | 'attemptId'
  | 'attemptItemId'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'isDemo'
  | 'errorCode'
  | 'result'
> {
  user: AdminUser;
}
export interface AdminDetail {
  submission: Submission;
  user: AdminUser;
  events: { id: number; type: string; createdAt: string; metadata: Record<string, unknown> }[];
  exactResponse: string | null;
}
export interface AdminFilters {
  status?: string;
  userId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}
export function fetchAdminSubmissions(filters: AdminFilters) {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return apiFetch<Page<AdminSummary>>(`/api/admin/submissions?${search}`);
}
export const fetchAdminDetail = (id: string) =>
  apiFetch<AdminDetail>(`/api/admin/submissions/${id}`);
