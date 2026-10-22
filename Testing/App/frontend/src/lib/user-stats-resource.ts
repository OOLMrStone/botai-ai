import { fetchStats, type Stats, type UserStats } from '@/lib/api/stats';
import { cachedResource } from '@/lib/cached-resource';
import { profileResource } from '@/lib/profile-resource';

export const userStatsResource = cachedResource<UserStats>(async () => {
  const [stats, profile] = await Promise.all([fetchStats(), profileResource.get()]);

  return {
    ...stats,
    totalStudyMinutes: stats.week.reduce((minutes, day) => minutes + day.minutes, 0),
    goalId: profile.goalId ?? '',
    levelId: profile.levelId ?? '',
  };
});

export function acceptStudyStats(stats: Stats) {
  const current = userStatsResource.peek();
  if (!current) return;
  userStatsResource.set({
    ...current,
    ...stats,
    totalStudyMinutes: stats.week.reduce((minutes, day) => minutes + day.minutes, 0),
  });
}
