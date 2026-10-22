'use client';

import { ArrowUpLeft } from 'lucide-react';
import Link from 'next/link';

import { layout } from '@/config/layout';
import { LEARNING_COPY } from '@/config/navigation';
import { ROUTES } from '@/config/onboarding-steps';
import { useLearningLayout } from '@/hooks/use-learning-layout';
import { cn } from '@/lib/utils';

export function LearningFrame({ children }: { children: React.ReactNode }) {
  const { mode, showExit } = useLearningLayout();

  return (
    <div className={cn(layout.viewport.width, layout.viewport.frame)}>
      <div className={cn(layout.learning.content, layout.learning[mode])}>
        {showExit && (
          <Link href={ROUTES.storefront} className={cn(layout.learning.flowExit, layout.focusRing)}>
            <ArrowUpLeft className={layout.learning.icon} />
            {LEARNING_COPY.storefront}
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}
