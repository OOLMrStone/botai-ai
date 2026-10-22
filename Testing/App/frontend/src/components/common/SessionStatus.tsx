'use client';

import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import type { AuthStatus } from '@/stores/auth-store';
import { SESSION_COPY } from '@/config/navigation';

export function SessionStatus({ status, retry }: { status: AuthStatus; retry: () => void }) {
  return (
    <ScreenShell center>
      {status === 'error' ? (
        <ErrorNote
          title={SESSION_COPY.errorTitle}
          message={SESSION_COPY.errorDescription}
          onRetry={retry}
        />
      ) : (
        <p role="status" className={layout.typography.description}>
          {COPY.profile.loading}
        </p>
      )}
    </ScreenShell>
  );
}
