import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { layout } from '@/config/layout';
import { COPY, ROUTES } from '@/config/onboarding-steps';
import { cn } from '@/lib/utils';

// Заглушка урока. Сам урок вне scope. «Завершить урок» → награда-streak.
export default function LessonPage() {
  return (
    <ScreenTransition>
      <ScreenShell
        center
        footer={
          <Link
            href={ROUTES.streak}
            className={cn(buttonVariants({ size: 'default' }), layout.cta)}
          >
            {COPY.lesson.action}
          </Link>
        }
      >
        <div className={layout.surface.illustration}>
          <GraduationCap className="size-8" />
        </div>

        <ScreenHeading title={COPY.lesson.title} subtitle={COPY.lesson.subtitle} />
      </ScreenShell>
    </ScreenTransition>
  );
}
