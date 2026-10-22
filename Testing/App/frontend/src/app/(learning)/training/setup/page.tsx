'use client';

import { Suspense } from 'react';

import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { TrainingSetupExperience } from '@/components/tasks/TrainingSetupExperience';
import { Skeleton } from '@/components/ui/skeleton';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { SessionStatus } from '@/components/common/SessionStatus';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useTasks } from '@/hooks/use-tasks';
import { useTrainingSetupRoute } from '@/hooks/use-training-setup-route';

export default function TrainingSetupPage() {
  return (
    <Suspense>
      <TrainingSetupContent />
    </Suspense>
  );
}

function TrainingSetupContent() {
  const { status, retry: retrySession } = useRequireAuth();
  const { tasks, failed, retry } = useTasks();
  const fixedExamNumber = useTrainingSetupRoute(tasks);

  if (status !== 'authenticated') return <SessionStatus status={status} retry={retrySession} />;
  if (tasks)
    return (
      <TrainingSetupExperience
        key={fixedExamNumber}
        tasks={tasks}
        fixedExamNumber={fixedExamNumber}
      />
    );

  return (
    <div className={layout.quiz.root}>
      <ScreenShell>
        {failed ? (
          <ErrorNote message={COPY.errors.tasks} onRetry={retry} />
        ) : (
          <Skeleton className={layout.tasks.skeleton} />
        )}
      </ScreenShell>
    </div>
  );
}
