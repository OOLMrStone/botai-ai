'use client';

import { ResultScreen } from '@/components/onboarding/ResultScreen';
import { ErrorNote } from '@/components/common/ErrorNote';
import { SessionStatus } from '@/components/common/SessionStatus';
import { COPY } from '@/config/onboarding-steps';
import { useCompleteOnboarding } from '@/hooks/use-complete-onboarding';

export default function DonePage() {
  const completion = useCompleteOnboarding();
  if (completion.session.status === 'error')
    return <SessionStatus status={completion.session.status} retry={completion.session.retry} />;
  return (
    <>
      {completion.error ? <ErrorNote message={completion.error} /> : null}
      <ResultScreen
        title={COPY.register.done.title}
        subtitle={COPY.register.done.subtitle}
        actionLabel={COPY.register.done.action}
        pending={completion.pending}
        onAction={() => void completion.finish()}
      />
    </>
  );
}
