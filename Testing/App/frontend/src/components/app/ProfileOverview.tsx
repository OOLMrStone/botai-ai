import { Clock, Flame, Target, Zap } from 'lucide-react';

import { StatTile } from '@/components/app/StatTile';
import { StreakCalendar } from '@/components/app/StreakCalendar';
import { ErrorNote } from '@/components/common/ErrorNote';
import { SectionHeading } from '@/components/common/SectionHeading';
import { Skeleton } from '@/components/ui/skeleton';
import { profileSkeletonTiles } from '@/config/app-layout';
import { layout } from '@/config/layout';
import { COPY, GOAL_OPTIONS } from '@/config/onboarding-steps';
import { PROFILE_COPY } from '@/config/profile';
import type { UserStatsState } from '@/hooks/use-user-stats';
import { formatStreakDays } from '@/lib/study-time';

export function ProfileOverview({ state }: { state: UserStatsState }) {
  const { stats, failed, retry } = state;
  const goal = stats ? GOAL_OPTIONS.find((option) => option.id === stats.goalId) : undefined;

  return (
    <div className={layout.app.profile.overview}>
      {stats ? (
        <>
          <div className={layout.app.profile.section}>
            <SectionHeading>{COPY.profile.overviewTitle}</SectionHeading>
            <div className={layout.app.profile.grid}>
              <StatTile
                icon={Flame}
                label={COPY.profile.overviewStreak}
                value={formatStreakDays(stats.streakDays)}
              />
              <StatTile
                icon={Clock}
                label={COPY.home.studyTimeLabel}
                value={stats.studyTimeLabel}
              />
              <StatTile
                icon={Target}
                label={COPY.profile.overviewGoal}
                value={goal?.description ?? PROFILE_COPY.goalUnset}
              />
              <StatTile
                icon={Zap}
                label={COPY.profile.overviewDailyGoal}
                value={`${stats.dailyGoalMinutes} ${COPY.profile.dailyGoalUnit}`}
              />
            </div>
          </div>
          <div className={layout.app.profile.calendarSection}>
            <SectionHeading>{COPY.profile.streakWeekTitle}</SectionHeading>
            <StreakCalendar week={stats.week} today={stats.date} />
          </div>
        </>
      ) : (
        <div className={layout.app.profile.section}>
          {failed ? (
            <ErrorNote message={COPY.errors.stats} onRetry={retry} />
          ) : (
            <div className={layout.app.profile.grid}>
              {profileSkeletonTiles.map((tile) => (
                <Skeleton key={tile} className={layout.app.profile.skeleton} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
