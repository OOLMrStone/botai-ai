'use client';

import { Loader2, Mail, MailCheck } from 'lucide-react';
import Link from 'next/link';

import { useEmailVerification } from '@/hooks/use-email-verification';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { LEARNING_COPY as C } from '@/config/integration';
import { MOTION_STYLES } from '@/config/motion';
import { cn } from '@/lib/utils';

export function VerifyEmailExperience() {
  const state = useEmailVerification();
  const StatusIcon = state.pending ? Loader2 : state.done ? MailCheck : Mail;

  return (
    <ScreenShell center>
      <div className={layout.emailVerification.root}>
        {state.invalid ? (
          <ErrorNote title={state.title} message={state.description} />
        ) : (
          <>
            <div className={layout.emailVerification.icon} aria-hidden="true">
              <StatusIcon
                className={cn(
                  layout.emailVerification.iconGlyph,
                  state.pending && MOTION_STYLES.loadingSpin,
                )}
              />
            </div>
            <div role="status" aria-live="polite" aria-atomic="true">
              <ScreenHeading variant="app" title={state.title} subtitle={state.description} />
            </div>
          </>
        )}
        {state.error ? <ErrorNote message={state.error} /> : null}
        {state.sessionFailed ? (
          <ErrorNote message={C.authError} onRetry={state.retrySession} />
        ) : null}
        <div className={layout.emailVerification.actions}>
          {state.canConfirm ? (
            <Button className={layout.cta} onClick={() => void state.confirm()}>
              {state.confirmLabel}
            </Button>
          ) : null}
          <Button
            render={<Link href={state.returnHref} />}
            nativeButton={false}
            className={layout.cta}
            variant={state.canConfirm ? 'ghost' : 'default'}
            disabled={state.returnPending}
          >
            {state.returnLabel}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
