'use client';

import { ResultScreen } from '@/components/onboarding/ResultScreen';
import { COPY } from '@/config/onboarding-steps';
import { useCompleteOnboarding } from '@/hooks/use-complete-onboarding';
import { ErrorNote } from '@/components/common/ErrorNote';
import { SessionStatus } from '@/components/common/SessionStatus';

export default function ReadyPage() {
  const completion = useCompleteOnboarding();
  if (completion.session.status === 'error')
    return <SessionStatus status={completion.session.status} retry={completion.session.retry} />;

  return (
    <>
      {completion.error ? <ErrorNote message={completion.error} /> : null}
      <ResultScreen
        title={COPY.ready.title}
        subtitle={COPY.ready.subtitle}
        actionLabel={COPY.ready.action}
        pending={completion.pending}
        onAction={completion.start}
      />
    </>
  );
}
