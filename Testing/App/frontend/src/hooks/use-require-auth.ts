'use client';

import { ROUTES } from '@/config/onboarding-steps';
import { useAuthRedirect } from '@/hooks/use-auth-redirect';

// Гард сессии для раздела после логина: при неизвестном статусе спрашивает бэкенд
// «кто я», анонима уводит на /login. Возвращает статус и повтор - экран решает, что
// показать, пока не 'authenticated'. Один источник правды для AppGuard и настроек.
export function useRequireAuth(returnTo?: string) {
  return useAuthRedirect({ anonymous: ROUTES.login, returnTo });
}
