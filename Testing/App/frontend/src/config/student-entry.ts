import { BRAND } from '@/config/brand';
import { COPY, onboardingPath, ROUTES } from '@/config/onboarding-steps';

export const STUDENT_ENTRY = {
  authenticated: ROUTES.home,
  anonymous: onboardingPath('welcome'),
} as const;

export const STUDENT_ENTRY_COPY = {
  loading: COPY.profile.loading,
  error: 'Не удалось проверить вход. Попробуй ещё раз',
  back: `На сайт ${BRAND.name}`,
} as const;
