import { apiFetch } from '@/lib/api/client';
export interface Stats {
  xp: number;
  streakDays: number;
  dailyGoalMinutes: number;
  dailyProgressMinutes: number;
  date: string;
  timeZone: string;
  week: { date: string; qualified: boolean; minutes: number }[];
  resumeAttempt: string | null;
}
export interface UserStats extends Stats {
  totalStudyMinutes: number;
  goalId: string;
  levelId: string;
}
export const fetchStats = () => apiFetch<Stats>('/api/stats');
