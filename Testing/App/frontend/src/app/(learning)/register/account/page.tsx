'use client';

import { RegistrationForm } from '@/components/onboarding/RegistrationForm';
import { useRegistration } from '@/hooks/use-registration';

export default function RegistrationPage() {
  const form = useRegistration();

  return <RegistrationForm form={form} />;
}
