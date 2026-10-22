import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { MascotPlaceholder } from '@/components/onboarding/MascotPlaceholder';
import { OAuthButtons } from '@/components/onboarding/OAuthButtons';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { layout } from '@/config/layout';
import { COPY, registerPath, ROUTES } from '@/config/onboarding-steps';
import { cn } from '@/lib/utils';

// Сохранение подготовки: регистрация по почте или вход в существующий аккаунт.
export default function SaveProgressPage() {
  return (
    <ScreenShell
      center
      footer={
        <div className={layout.auth.footer}>
          <OAuthButtons redirectTo={ROUTES.done} separator="after" />

          <Link
            href={registerPath('account')}
            className={cn(buttonVariants({ size: 'default' }), layout.cta)}
          >
            {COPY.register.saveProgress.emailCta}
          </Link>

          <Link
            href={ROUTES.login}
            className={cn(buttonVariants({ variant: 'ghost' }), layout.cta)}
          >
            {COPY.register.saveProgress.loginCta}
          </Link>
        </div>
      }
    >
      <MascotPlaceholder />

      <ScreenHeading
        title={COPY.register.saveProgress.title}
        subtitle={COPY.register.saveProgress.subtitle}
      />
    </ScreenShell>
  );
}
