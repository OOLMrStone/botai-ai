'use client';

import { BrandText } from '@/components/onboarding/BrandText';
import Link from 'next/link';

import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { ROUTES } from '@/config/onboarding-steps';
import { STUDENT_ENTRY_COPY as COPY } from '@/config/student-entry';
import { useStudentEntry } from '@/hooks/use-student-entry';

export function StudentEntry() {
  const { failed, retry } = useStudentEntry();

  return (
    <ScreenShell
      center
      footer={
        <Button
          render={<Link href={ROUTES.storefront} />}
          nativeButton={false}
          variant="ghost"
          className={layout.cta}
          size="default"
        >
          <BrandText text={COPY.back} />
        </Button>
      }
    >
      <div role="status" aria-live="polite">
        <ScreenHeading title={<Wordmark />} subtitle={failed ? undefined : COPY.loading} />
      </div>
      {failed ? <ErrorNote message={COPY.error} onRetry={retry} /> : null}
    </ScreenShell>
  );
}
