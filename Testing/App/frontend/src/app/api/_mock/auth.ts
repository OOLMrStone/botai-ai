// Локальный дублёр Spring-бэкенда аутентификации: живёт, пока реальный бэк за
// nginx не поднят (переключатель - режим сборки, см. config/env). Ставит куки
// SESSION (HttpOnly) и XSRF-TOKEN, проверяет CSRF, отдаёт 401 без сессии.

import { NextResponse, type NextRequest } from 'next/server';

import {
  closeSession,
  findAccount,
  openSession,
  saveAccount,
  sessionAccount,
  type Account,
} from '@/app/api/_mock/db';
import {
  clearSession,
  csrfValid,
  problem,
  sessionToken,
  setSession,
  toUser,
} from '@/app/api/_mock/http';
import { AUTH_COOKIE } from '@/config/auth';
import { DEFAULT_PLAN } from '@/config/plans';

export function issueCsrf(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(AUTH_COOKIE.xsrf, crypto.randomUUID(), { sameSite: 'lax', path: '/' });
  return response;
}

export async function register(request: NextRequest): Promise<NextResponse> {
  if (!csrfValid(request)) return problem(403, 'Неверный CSRF-токен');

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    displayName?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  if (!email || !body?.password) return problem(400, 'Почта и пароль обязательны');
  if (findAccount(email)) return problem(409, 'Почта уже занята');

  // Регистрация не создаёт сессию - клиент сразу дёргает login.
  const account: Account = {
    id: crypto.randomUUID(),
    email,
    password: body.password,
    displayName: body.displayName ?? null,
    role: 'USER',
    authProvider: 'LOCAL',
    plan: DEFAULT_PLAN,
  };
  saveAccount(account);

  return NextResponse.json(toUser(account), { status: 201 });
}

export async function login(request: NextRequest): Promise<NextResponse> {
  if (!csrfValid(request)) return problem(403, 'Неверный CSRF-токен');

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const account = email ? findAccount(email) : undefined;
  if (!account || account.password !== body?.password) {
    return problem(401, 'Неверная почта или пароль');
  }

  const token = crypto.randomUUID();
  openSession(token, account.email);

  const response = NextResponse.json(toUser(account));
  setSession(response, token);
  return response;
}

export function me(request: NextRequest): NextResponse {
  const account = sessionAccount(sessionToken(request));
  if (!account) return problem(401, 'Сессия не найдена');

  return NextResponse.json(toUser(account));
}

export function logout(request: NextRequest): NextResponse {
  const token = sessionToken(request);
  if (token) closeSession(token);

  const response = new NextResponse(null, { status: 204 });
  clearSession(response);
  return response;
}
