'use client';
import { useParams } from 'next/navigation';
import { AdminSubmissionDetail } from '@/components/app/AdminSubmissions';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { LEARNING_COPY as C } from '@/config/integration';
export default function AdminDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ScreenShell bottomNavigation scrollPage>
      <ScreenHeading variant="app" title={C.admin} />
      <AdminSubmissionDetail id={id} />
    </ScreenShell>
  );
}
