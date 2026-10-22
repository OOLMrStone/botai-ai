import { redirect } from 'next/navigation';

import { nextOnboardingPath } from '@/config/onboarding-steps';

export default function BuildingPage() {
  redirect(nextOnboardingPath('building'));
}
