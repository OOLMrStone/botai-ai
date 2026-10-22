import { OnboardingHeader } from '@/components/onboarding/OnboardingHeader';
import { layout } from '@/config/layout';
import { REGISTER_STEPS } from '@/config/onboarding-steps';

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={layout.auth.registerLayout}>
      <OnboardingHeader steps={REGISTER_STEPS} />
      <main className={layout.auth.registerMain}>{children}</main>
    </div>
  );
}
