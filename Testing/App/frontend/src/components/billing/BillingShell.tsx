'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { SessionStatus } from '@/components/common/SessionStatus';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { Button } from '@/components/ui/button';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import { ROUTES } from '@/config/onboarding-steps';
import { useRequireAuth } from '@/hooks/use-require-auth';

export function BillingGate({ returnTo, children }: { returnTo: string; children: ReactNode }) {
  const session = useRequireAuth(returnTo);
  return session.status === 'authenticated' ? (
    children
  ) : (
    <SessionStatus status={session.status} retry={session.retry} />
  );
}

export function BillingShell({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className={layout.billing.shell}>
      <header className={layout.billing.header}>
        <Button
          size="icon-compact"
          variant="ghost"
          aria-label={C.back}
          onClick={() => router.push(ROUTES.home)}
        >
          <ChevronLeft className={layout.billing.icon} aria-hidden />
        </Button>
        <Wordmark variant="compact" />
        <span className={layout.billing.badge}>{C.badge}</span>
      </header>
      <main className={layout.billing.content}>
        <div className={layout.billing.heading}>
          <ScreenHeading variant="offer" title={title} />
          <p className={layout.billing.secondary}>{C.notice}</p>
        </div>
        {children}
      </main>
      <footer className={layout.billing.footer}>
        <div className={layout.billing.actions}>
          {footer ?? (
            <Button size="multiline" variant="ghost" onClick={() => router.push(ROUTES.home)}>
              {C.back}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
