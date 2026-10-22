'use client';

import { ChevronLeft } from 'lucide-react';

import { ProfileEditFields } from '@/components/app/ProfileEditFields';
import { ProfileAccountSettings } from '@/components/app/ProfileAccountSettings';
import { ErrorNote } from '@/components/common/ErrorNote';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useProfileSettings } from '@/hooks/use-profile-settings';
import { useLogout } from '@/hooks/use-logout';
import { SessionStatus } from '@/components/common/SessionStatus';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

// Экран настроек (вне таб-бара, свой back): обращение, цель дня, цель по ЕГЭ.
// Открывается из профиля. Гард сессии - use-require-auth, как в AppGuard.
export default function SettingsPage() {
  const settings = useProfileSettings();
  const { status, retry: retrySession } = useRequireAuth();
  const { logout, pending: loggingOut, failed: logoutFailed } = useLogout();
  const user = useAuthStore((s) => s.user);
  if (status !== 'authenticated') return <SessionStatus status={status} retry={retrySession} />;

  if (!user || !settings.profile.data) {
    return (
      <div className={layout.settings.loading}>
        {settings.profile.failed ? (
          <ErrorNote message={COPY.errors.stats} onRetry={settings.profile.retry} />
        ) : (
          <p className="text-muted-foreground">{COPY.profile.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className={layout.settings.shell}>
      <header className={layout.settings.header}>
        <button
          type="button"
          onClick={() => settings.back()}
          aria-label={COPY.nav.back}
          className={layout.settings.backButton}
        >
          <ChevronLeft className={layout.settings.backIcon} />
        </button>
        <ScreenHeading variant="navigation" title={COPY.settings.title} />
      </header>

      <div className={cn(layout.scroll, layout.settings.content, layout.shell.padX)}>
        <ProfileAccountSettings
          profile={settings.profile}
          email={user.email}
          verified={user.emailVerified !== false}
        />
        <ProfileEditFields
          name={settings.name}
          onNameChange={settings.setNameDraft}
          goalId={settings.goalId}
          onGoalChange={settings.setGoalDraft}
          levelId={settings.levelId}
          onLevelChange={settings.setLevelDraft}
          dailyMinutes={settings.minutes!}
          onDailyChange={settings.setMinutesDraft}
        />
        <div className={layout.settings.logoutSection}>
          {logoutFailed ? <ErrorNote message={COPY.errors.logout} /> : null}
          <Button
            variant="ghost"
            className={cn(layout.settings.logoutAction, layout.typography.controlTitle)}
            disabled={settings.saving || loggingOut}
            onClick={logout}
          >
            {COPY.settings.logout}
          </Button>
        </div>
      </div>

      <div className={cn(layout.settings.footer, layout.shell.padX, layout.shell.padBottom)}>
        {settings.error ? <ErrorNote message={settings.error} /> : null}
        <Button
          className={layout.cta}
          size="default"
          disabled={settings.saving || loggingOut}
          onClick={() => void settings.save()}
        >
          {COPY.settings.save}
        </Button>
      </div>
    </div>
  );
}
