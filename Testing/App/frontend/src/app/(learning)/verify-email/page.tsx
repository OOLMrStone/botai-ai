import { Suspense } from 'react';
import { VerifyEmailExperience } from '@/components/onboarding/VerifyEmailExperience';
export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyEmailExperience />
    </Suspense>
  );
}
