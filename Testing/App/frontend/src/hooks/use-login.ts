'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { COPY, onboardingPath, ROUTES } from '@/config/onboarding-steps';
import { loginUser } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { isValidEmail } from '@/lib/validation';
import { useAuthStore } from '@/stores/auth-store';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { takeAuthReturn } from '@/lib/auth-return';

export function useLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const valid = isValidEmail(email.trim()) && password.length > 0;

  const submit = async () => {
    if (!valid || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);

    try {
      const user = await loginUser({ email: email.trim(), password });
      useAuthStore.getState().setUser(user);
      router.push(
        takeAuthReturn() ??
          (useOnboardingStore.getState().needsProfileSave ? ROUTES.done : ROUTES.home),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? COPY.login.badCredentials
          : COPY.login.error,
      );
      busy.current = false;
      setPending(false);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    pending,
    error,
    valid,
    submit,
    register: () => router.push(onboardingPath('welcome')),
  };
}
