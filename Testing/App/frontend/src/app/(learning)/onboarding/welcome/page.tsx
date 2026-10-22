'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ParticleSphere } from '@/components/onboarding/ParticleSphere';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { EMBEDDED_BO } from '@/config/embedded-bo';
import { useOnboardingBo } from '@/hooks/use-onboarding-bo';
import { layout } from '@/config/layout';
import { COPY, ROUTES } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';

export default function WelcomePage() {
  const router = useRouter();
  const { goNext } = useOnboardingFlow('welcome');
  const bo = useOnboardingBo();

  return (
    <ScreenShell
      center
      footer={
        <div className={layout.ctaStack}>
          <Button
            className={layout.cta}
            size="default"
            onClick={() => {
              bo.start();
              goNext();
            }}
          >
            {COPY.welcome.primary}
          </Button>
          <Button
            variant="ghost"
            className={layout.cta}
            size="default"
            onClick={() => router.push(ROUTES.login)}
          >
            {COPY.welcome.secondary}
          </Button>
        </div>
      }
    >
      {EMBEDDED_BO.welcomeSphereEnabled ? <ParticleSphere /> : null}

      <ScreenHeading title={<Wordmark />} subtitle={COPY.welcome.subtitle} />
    </ScreenShell>
  );
}
