import { apiFetch } from '@/lib/api/client';
import type { FeatureId, PlanId } from '@/config/plans';
export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  registeredAt: string;
  avatarUrl: string | null;
  goalId: string | null;
  levelId: string | null;
  dailyGoalMinutes: number;
  timeZone: string;
  notificationsEnabled: boolean;
  plan: PlanId;
  features: FeatureId[];
}
export interface ProfileSettingsPayload {
  name: string | null;
  goalId: string | null;
  levelId?: string | null;
  dailyGoalMinutes: number;
}
export const fetchProfile = () => apiFetch<Profile>('/api/profile');
export const updateProfileSettings = ({ name, ...patch }: ProfileSettingsPayload) =>
  apiFetch<Profile>('/api/profile', { method: 'PATCH', json: { displayName: name, ...patch } });
export async function uploadAvatar(file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<{ avatarUrl: string }>('/api/profile/avatar', { method: 'POST', body });
}
export const removeAvatar = () =>
  apiFetch<{ avatarUrl: null }>('/api/profile/avatar', { method: 'DELETE' });
