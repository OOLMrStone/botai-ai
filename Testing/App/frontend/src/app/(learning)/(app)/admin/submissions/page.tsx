import { AdminSubmissions } from '@/components/app/AdminSubmissions';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { LEARNING_COPY as C } from '@/config/integration';
export default function AdminPage() {
  return (
    <ScreenShell bottomNavigation scrollPage>
      <ScreenHeading variant="app" title={C.admin} />
      <AdminSubmissions />
    </ScreenShell>
  );
}
