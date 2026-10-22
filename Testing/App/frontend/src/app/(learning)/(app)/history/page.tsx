'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { SavedAttempts } from '@/components/app/SavedAttempts';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { Button } from '@/components/ui/button';
import { ATTEMPT_COPY } from '@/config/attempts';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { ROUTES } from '@/config/onboarding-steps';

export default function HistoryPage() {
  return (
    <ScreenShell bottomNavigation>
      <div className={layout.app.history.content}>
        <div className={layout.app.history.header}>
          <div className={layout.app.history.heading}>
            <ScreenHeading
              variant="app"
              title={LEARNING_COPY.history}
              subtitle={ATTEMPT_COPY.historySubtitle}
            />
          </div>
          <Button
            variant="outline"
            size="compact"
            nativeButton={false}
            render={<Link href={ROUTES.tasks} />}
          >
            {ATTEMPT_COPY.newTraining}
            <ArrowUpRight className={layout.app.attempts.icon} aria-hidden="true" />
          </Button>
        </div>
        <SavedAttempts history />
      </div>
    </ScreenShell>
  );
}
