'use client';
import { TrainingShell } from '@/components/tasks/TrainingShell';
import { SessionStatus } from '@/components/common/SessionStatus';
import { useAttemptRoute } from '@/hooks/use-attempt-route';
export function TrainingExperience() {
  const { auth, id } = useAttemptRoute();
  if (auth.status !== 'authenticated') return <SessionStatus {...auth} />;
  return id ? <TrainingShell key={id} attemptId={id} /> : null;
}
