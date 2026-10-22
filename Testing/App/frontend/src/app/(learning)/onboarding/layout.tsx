import { OnboardingBoProvider } from '@/components/onboarding/OnboardingBoProvider';
import { layout } from '@/config/layout';
import { OnboardingHeader } from '@/components/onboarding/OnboardingHeader';
import { ONBOARDING_STEPS } from '@/config/onboarding-steps';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingBoProvider>
      <div className={layout.embeddedBo.onboardingRoot}>
        <OnboardingHeader steps={ONBOARDING_STEPS} />
        <main className={layout.embeddedBo.onboardingMain}>{children}</main>
      </div>
    </OnboardingBoProvider>
  );
}
