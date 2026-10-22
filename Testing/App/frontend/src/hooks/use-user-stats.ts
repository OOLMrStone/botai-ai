'use client';

import { useAsyncData, type AsyncData } from '@/hooks/use-async-data';
import type { UserStats } from '@/lib/api/stats';
import { userStatsResource } from '@/lib/user-stats-resource';
import { formatStudyTime } from '@/lib/study-time';
import { useProfileStore } from '@/stores/profile-store';

export interface UserStatsState extends Omit<AsyncData<UserStats>, 'data'> {
  // null - ещё грузится или запрос упал: экран показывает скелетон или плашку.
  stats: (UserStats & { studyTimeLabel: string }) | null;
}

// Статистика для хаба, профиля и настроек. База - с бэкенда; поверх накладываем
// правки пользователя из profile-store (цель, цель дня), чтобы экраны совпадали.
export function useUserStats(): UserStatsState {
  const { data, loading, failed, retry } = useAsyncData(userStatsResource);
  const goalId = useProfileStore((s) => s.goalId);
  const dailyGoalMinutes = useProfileStore((s) => s.dailyGoalMinutes);

  const stats = data
    ? {
        ...data,
        studyTimeLabel: formatStudyTime(data.totalStudyMinutes),
        goalId: goalId ?? data.goalId,
        dailyGoalMinutes: dailyGoalMinutes ?? data.dailyGoalMinutes,
      }
    : null;

  return { stats, loading, failed, retry };
}
