import { EMPTY_REGISTRATION } from '@/config/auth';
import type { RegisterPayload } from '@/lib/api/auth';
import { isValidEmail, isValidName, isValidPassword } from '@/lib/validation';

interface SavedRegistration extends Partial<RegisterPayload> {
  firstName?: string;
  lastName?: string;
}

export function restoreRegistration(saved?: SavedRegistration): RegisterPayload {
  return {
    ...EMPTY_REGISTRATION,
    displayName:
      saved?.displayName ?? [saved?.firstName, saved?.lastName].filter(Boolean).join(' '),
    email: saved?.email ?? EMPTY_REGISTRATION.email,
  };
}

export const REGISTRATION_VALIDATORS = {
  displayName: isValidName,
  email: (email: string) => isValidEmail(email.trim()),
  password: isValidPassword,
};

export function isValidRegistration(registration: RegisterPayload): boolean {
  return Object.entries(REGISTRATION_VALIDATORS).every(([name, validate]) =>
    validate(registration[name as keyof RegisterPayload]),
  );
}
