import { Clock, Flame } from 'lucide-react';

import { Wordmark } from '@/components/onboarding/Wordmark';
import { Skeleton } from '@/components/ui/skeleton';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { STREAK_FORMAT } from '@/config/user-stats';
import { formatStreakDays } from '@/lib/study-time';

interface HomeStatusBarProps {
  streakDays: number;
  studyTimeLabel: string;
}

// Стрик и время обучения приходят из одной статистики с профилем.
// aria-label на стрике, потому что одна цифра рядом с иконкой без него непонятна.
export function HomeStatusBar({ streakDays, studyTimeLabel }: HomeStatusBarProps) {
  return (
    <div className={layout.app.home.status}>
      <span
        className={layout.app.home.statusItem}
        aria-label={STREAK_FORMAT.label(formatStreakDays(streakDays))}
      >
        <Flame className={layout.app.home.statusIcon} />
        {streakDays}
      </span>

      <span className={layout.app.home.brand}>
        <Wordmark variant="compact" />
      </span>
      <span
        className={layout.app.home.statusEnd}
        aria-label={`${COPY.home.studyTimeLabel}: ${studyTimeLabel}`}
      >
        <Clock className={layout.app.home.statusIcon} aria-hidden="true" />
        {studyTimeLabel}
      </span>
    </div>
  );
}

export function HomeStatusBarSkeleton() {
  return (
    <div className={layout.app.home.status}>
      <Skeleton className={layout.app.skeleton.status} />
      <span className={layout.app.home.brand}>
        <Wordmark variant="compact" />
      </span>
      <Skeleton className={layout.app.skeleton.status} />
    </div>
  );
}
