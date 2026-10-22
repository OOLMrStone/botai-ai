'use client';

import { DailyGoalRing, DailyGoalRingSkeleton } from '@/components/app/DailyGoalRing';
import { HomeHangingBo } from '@/components/lemur/HomeHangingBo';
import { SavedAttempts } from '@/components/app/SavedAttempts';
import { HomeStatusBar, HomeStatusBarSkeleton } from '@/components/app/HomeStatusBar';
import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useUserStats } from '@/hooks/use-user-stats';
import { useAuthStore } from '@/stores/auth-store';
import { useProfileStore } from '@/stores/profile-store';

// Главная показывает последние выходы, полная история остаётся на отдельном экране.
export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const { stats, failed, retry } = useUserStats();
  const nameOverride = useProfileStore((s) => s.name);

  const name = nameOverride ?? user?.displayName ?? user?.email ?? '';
  const loading = !stats && !failed;

  return (
    <ScreenShell bottomNavigation>
      <div className={layout.app.home.content}>
        <div className={layout.app.home.header}>
          {stats ? (
            <HomeStatusBar streakDays={stats.streakDays} studyTimeLabel={stats.studyTimeLabel} />
          ) : loading ? (
            <HomeStatusBarSkeleton />
          ) : null}
          <div className={layout.app.home.heading}>
            <ScreenHeading
              variant="app"
              title={`${COPY.home.greeting}, ${name}!`}
              subtitle={COPY.home.tagline}
            />
          </div>
        </div>

        {failed ? <ErrorNote message={COPY.errors.stats} onRetry={retry} /> : null}

        <div className={layout.app.home.cards}>
          <div className={layout.app.home.aside}>
            {stats ? (
              <DailyGoalRing
                progressMinutes={stats.dailyProgressMinutes}
                goalMinutes={stats.dailyGoalMinutes}
                className={layout.app.home.goalCard}
                mascot={layout.app.home.mascotEnabled ? <HomeHangingBo /> : undefined}
              />
            ) : loading ? (
              <DailyGoalRingSkeleton
                className={layout.app.home.goalCard}
                mascot={layout.app.home.mascotEnabled ? <HomeHangingBo /> : undefined}
              />
            ) : null}
          </div>
          <SavedAttempts />
        </div>
      </div>
    </ScreenShell>
  );
}
