'use client';

import { SessionStatus } from '@/components/common/SessionStatus';
import { useRequireAuth } from '@/hooks/use-require-auth';

// Гард раздела (app): пускаем только с живой сессией (логика в use-require-auth,
// общая с экраном настроек). Серверного middleware нет, проверка клиентская.
export function AppGuard({ children }: { children: React.ReactNode }) {
  const { status, retry: retrySession } = useRequireAuth();

  if (status !== 'authenticated') return <SessionStatus status={status} retry={retrySession} />;

  return <>{children}</>;
}
