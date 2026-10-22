import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { AppNavigation } from '@/components/app/AppNavigation';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { LEARNING_COPY } from '@/config/navigation';
import { ROUTES } from '@/config/onboarding-steps';

export function QuizzesComingSoon() {
  return (
    <div className={layout.learning.app}>
      <main className={layout.learning.main}>
        <ScreenShell bottomNavigation center>
          <div className={layout.bottomNav.soonContent}>
            <Sparkles className={layout.bottomNav.soonArt} aria-hidden="true" />
            <ScreenHeading
              variant="app"
              title={LEARNING_COPY.quizSoon}
              subtitle={LEARNING_COPY.quizDescription}
            />
            <Button nativeButton={false} render={<Link href={ROUTES.tasks} />}>
              {LEARNING_COPY.chooseTasks}
            </Button>
          </div>
        </ScreenShell>
      </main>
      <AppNavigation />
    </div>
  );
}
