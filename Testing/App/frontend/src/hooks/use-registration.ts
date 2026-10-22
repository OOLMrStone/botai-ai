'use client';

import { useRef, useState } from 'react';

import { COPY } from '@/config/onboarding-steps';
import { useRegisterFlow } from '@/hooks/use-flow-navigation';
import { registerUser } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { isValidRegistration } from '@/lib/registration';
import { useAuthStore } from '@/stores/auth-store';
import { useOnboardingStore } from '@/stores/onboarding-store';

export function useRegistration() {
  const { goNext } = useRegisterFlow('account');
  const registration = useOnboardingStore((state) => state.registration);
  const updateRegistration = useOnboardingStore((state) => state.updateRegistration);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const valid = isValidRegistration(registration);

  const submit = async () => {
    if (!valid || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);

    try {
      const user = await registerUser({
        ...registration,
        displayName: registration.displayName.trim(),
        email: registration.email.trim(),
      });
      useAuthStore.getState().setUser(user);
      updateRegistration({ password: '' });
      goNext();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? COPY.register.account.emailTaken
          : COPY.register.account.error,
      );
      busy.current = false;
      setPending(false);
    }
  };

  return { registration, updateRegistration, pending, error, valid, submit };
}
