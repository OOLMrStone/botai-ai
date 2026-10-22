// Общие кирпичики мок-бэкенда: формат ошибки, проверка CSRF, кука сессии.
// Ведут себя как настоящий Spring - на клиенте (lib/api, стор) менять нечего.

import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE, AUTH_HEADER } from '@/config/auth';
import type { Account } from '@/app/api/_mock/db';
import type { User } from '@/lib/api/auth';

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;

export function toUser(account: Account): User {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    authProvider: account.authProvider,
    plan: account.plan,
  };
}

export function problem(status: number, detail: string): NextResponse {
  // Формат RFC 9457, как у реального бэка - клиент читает поле detail.
  return NextResponse.json({ detail }, { status });
}

// CSRF по double-submit: заголовок должен совпасть с кукой XSRF-TOKEN.
export function csrfValid(request: NextRequest): boolean {
  const cookie = request.cookies.get(AUTH_COOKIE.xsrf)?.value;
  const header = request.headers.get(AUTH_HEADER.xsrf);
  return Boolean(cookie) && cookie === header;
}

export function sessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(AUTH_COOKIE.session)?.value;
}

export function setSession(response: NextResponse, token: string): void {
  response.cookies.set(AUTH_COOKIE.session, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearSession(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE.session, '', { httpOnly: true, path: '/', maxAge: 0 });
}
