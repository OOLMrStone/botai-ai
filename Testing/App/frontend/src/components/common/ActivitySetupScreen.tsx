'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { useSetupDismiss } from '@/hooks/use-setup-dismiss';

interface ActivitySetupScreenProps {
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  onClose: () => void;
}

export function ActivitySetupScreen({
  children,
  footer,
  closeLabel,
  onClose,
}: ActivitySetupScreenProps) {
  const screenRef = useSetupDismiss(onClose);

  return (
    <div data-activity-setup ref={screenRef} className={layout.quiz.root}>
      <ScreenTransition>
        <header className={layout.quiz.header}>
          <Button
            variant="ghost"
            size="icon-compact"
            className={layout.activitySetup.closeAlignment}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X className={layout.quiz.icon} />
          </Button>
        </header>
        <ScreenShell footer={footer}>{children}</ScreenShell>
      </ScreenTransition>
    </div>
  );
}
