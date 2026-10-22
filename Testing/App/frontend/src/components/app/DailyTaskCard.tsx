'use client';

import { useState } from 'react';

import { AppCard } from '@/components/app/AppCard';
import { Skeleton } from '@/components/ui/skeleton';
import { layout } from '@/config/layout';
import { Button } from '@/components/ui/button';
import type { DailyTask } from '@/config/daily-tasks';
import { COPY } from '@/config/onboarding-steps';

// Карточка задачи дня: условие и ответ по кнопке. Ответ прячем, чтобы сначала
// подумать - в этом весь смысл задачи дня.
export function DailyTaskCard({ task, className }: { task: DailyTask; className?: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <AppCard className={className}>
      <p className={layout.typography.description}>{COPY.home.dailyTaskTitle}</p>
      <p className={layout.app.home.question}>{task.question}</p>

      {revealed ? (
        <p
          className={layout.app.home.answer}
        >{`${COPY.home.dailyTaskAnswerPrefix}: ${task.answer}`}</p>
      ) : (
        <Button
          variant="outline"
          className={layout.app.home.reveal}
          onClick={() => setRevealed(true)}
        >
          {COPY.home.dailyTaskReveal}
        </Button>
      )}
    </AppCard>
  );
}

export function DailyTaskCardSkeleton({ className }: { className?: string }) {
  return (
    <AppCard className={className}>
      <Skeleton className={layout.app.skeleton.caption} />
      <Skeleton className={layout.app.skeleton.question} />
      <Skeleton className={layout.app.skeleton.action} />
    </AppCard>
  );
}
