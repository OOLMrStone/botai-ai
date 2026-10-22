// Тариф пользователя в мок-бэкенде. Реальный бэкенд сменит тариф после оплаты,
// здесь смена мгновенная - это и позволяет тестировать платные фичи.

import { NextResponse, type NextRequest } from 'next/server';

import { saveAccount, sessionAccount } from '@/app/api/_mock/db';
import { csrfValid, problem, sessionToken, toUser } from '@/app/api/_mock/http';
import { PLANS, type PlanId } from '@/config/plans';

export async function changePlan(request: NextRequest): Promise<NextResponse> {
  if (!csrfValid(request)) return problem(403, 'Неверный CSRF-токен');

  const account = sessionAccount(sessionToken(request));
  if (!account) return problem(401, 'Сессия не найдена');

  const body = (await request.json().catch(() => null)) as { plan?: string } | null;
  if (!body?.plan || !(body.plan in PLANS)) return problem(400, 'Неизвестный тариф');

  saveAccount({ ...account, plan: body.plan as PlanId });

  return NextResponse.json(toUser({ ...account, plan: body.plan as PlanId }));
}
