import { BRAND } from '@/config/brand';

export const B2B_TASK_NUMBERS = [14, 15, 16, 17, 18, 19, 20] as const;

export const B2B_PRE_DISPATCH_ERRORS = [
  'grading_unavailable',
  'storage_unavailable',
  'queue_full',
  'daily_grading_limit',
  'submission_rate_limit',
] as const;

export function b2bMetadata(title: string, description: string) {
  return { title: `${title} | ${BRAND.name}`, description };
}

export const B2B_COPY = {
  email: 'Почта',
  password: 'Пароль',
  login: 'Войти',
  signingIn: 'Входим',
} as const;
