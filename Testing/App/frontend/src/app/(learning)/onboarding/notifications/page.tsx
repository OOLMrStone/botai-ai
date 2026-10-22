import { redirect } from 'next/navigation';

import { nextOnboardingPath } from '@/config/onboarding-steps';

export default function NotificationsPage() {
  redirect(nextOnboardingPath('notifications'));
}
