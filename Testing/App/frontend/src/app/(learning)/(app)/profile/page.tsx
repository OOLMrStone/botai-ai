'use client';

import { ProfileAvatar } from '@/components/app/ProfileAvatar';
import { ProfileLinks } from '@/components/app/ProfileLinks';
import { ProfileOverview } from '@/components/app/ProfileOverview';
import { PROFILE_COPY } from '@/config/profile';
import { formatProfileDate } from '@/lib/profile-date';
import { ProfilePlanCard } from '@/components/paywall/ProfilePlanCard';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { useProfile } from '@/hooks/use-profile';
import { useBillingCapability } from '@/hooks/use-billing-capability';
import { LEARNING_COPY as C, LEARNING_ROUTES } from '@/config/integration';
import Link from 'next/link';
import { useUserStats } from '@/hooks/use-user-stats';
import { useAuthStore } from '@/stores/auth-store';
import { useProfileStore } from '@/stores/profile-store';
import { cn } from '@/lib/utils';

// Вкладка «Профиль»: витрина - личность, строка «Настройки» → экран правки,
// сетка «Обзор» и неделя в ударе. Живую сессию гарантирует AppGuard.
export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const stats = useUserStats();
  const profile = useProfile();
  const billingEnabled = useBillingCapability();
  const nameOverride = useProfileStore((s) => s.name);

  if (!user) return null;

  const displayName = profile.data?.displayName ?? nameOverride ?? user.displayName ?? user.email;

  return (
    <ScreenShell bottomNavigation scrollPage>
      <div className={layout.app.profile.content}>
        <div className={layout.app.profile.identity}>
          <ProfileAvatar url={profile.data?.avatarUrl} />
          <div className={layout.app.profile.identityText}>
            <ScreenHeading variant="app" title={displayName} />
            {profile.data ? (
              <p className={layout.app.profile.joined}>
                {PROFILE_COPY.joined(formatProfileDate(profile.data.registeredAt))}
              </p>
            ) : null}
          </div>
        </div>
        <ProfileOverview state={stats} />
        <div className={layout.app.profile.account}>
          {!billingEnabled ? (
            <div className={layout.app.profile.plan}>
              <ProfilePlanCard />
            </div>
          ) : null}
          <ProfileLinks billingEnabled={billingEnabled} />
          {user.role === 'ADMIN' ? (
            <Link
              href={LEARNING_ROUTES.admin}
              className={cn(layout.typography.description, layout.app.profile.admin)}
            >
              {C.admin}
            </Link>
          ) : null}
        </div>
      </div>
    </ScreenShell>
  );
}
