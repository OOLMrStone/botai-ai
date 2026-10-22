import type { ReactNode } from 'react';

import { AppCard } from '@/components/app/AppCard';
import { Skeleton } from '@/components/ui/skeleton';
import { dailyGoalRing } from '@/config/app-layout';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';

interface DailyGoalRingProps {
  progressMinutes: number;
  goalMinutes: number;
  className?: string;
  mascot?: ReactNode;
}

export function DailyGoalRing({
  progressMinutes,
  goalMinutes,
  className,
  mascot,
}: DailyGoalRingProps) {
  const circumference = 2 * Math.PI * dailyGoalRing.radius;
  const fraction = goalMinutes > 0 ? Math.min(Math.max(progressMinutes / goalMinutes, 0), 1) : 0;
  const done = goalMinutes > 0 && progressMinutes >= goalMinutes;

  return (
    <DailyGoalPanel className={className} mascot={mascot}>
      <p className={layout.app.home.goalTitle}>
        {done ? COPY.home.dailyGoalDone : COPY.home.dailyGoalTitle}
      </p>
      <div className={layout.app.home.ring}>
        <svg viewBox={dailyGoalRing.viewBox} className={layout.app.home.ringSvg} aria-hidden="true">
          <circle
            cx={dailyGoalRing.center}
            cy={dailyGoalRing.center}
            r={dailyGoalRing.radius}
            fill="none"
            strokeWidth={dailyGoalRing.strokeWidth}
            className={layout.app.home.ringTrack}
          />
          <circle
            cx={dailyGoalRing.center}
            cy={dailyGoalRing.center}
            r={dailyGoalRing.radius}
            fill="none"
            strokeWidth={dailyGoalRing.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            transform={dailyGoalRing.start}
            className={layout.app.home.ringProgress}
          />
        </svg>
        <div className={layout.app.home.ringLabel}>
          <p className={layout.app.home.ringValue}>{progressMinutes}</p>
          <p className={layout.app.home.ringGoal}>{COPY.home.dailyGoalTotal(goalMinutes)}</p>
        </div>
      </div>
    </DailyGoalPanel>
  );
}

interface DailyGoalPanelProps {
  className?: string;
  mascot?: ReactNode;
  children?: ReactNode;
}

function DailyGoalPanel({ className, mascot, children }: DailyGoalPanelProps) {
  return (
    <AppCard className={className}>
      <div className={layout.app.home.goalContent}>{children}</div>
      {mascot ? <div className={layout.app.home.goalMascot}>{mascot}</div> : null}
    </AppCard>
  );
}

export function DailyGoalRingSkeleton({ className, mascot }: DailyGoalPanelProps) {
  return (
    <DailyGoalPanel className={className} mascot={mascot}>
      <Skeleton className={layout.app.skeleton.caption} />
      <div className={layout.app.home.ring}>
        <Skeleton className={layout.app.home.ringSkeleton} />
        <Skeleton className={layout.app.home.goalMetricSkeleton} />
      </div>
    </DailyGoalPanel>
  );
}
