import { redirect } from 'next/navigation';

import { registerPath } from '@/config/onboarding-steps';

export default function LegacyRegistrationPage() {
  redirect(registerPath('account'));
}
