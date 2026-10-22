// HTTP-клиент API. Сессию держит бэкенд в куке SESSION (HttpOnly) - браузер
// прикладывает её сам. Для мутирующих запросов бэкенд требует CSRF-токен:
// читаем куку XSRF-TOKEN и возвращаем её значение в заголовке X-XSRF-TOKEN.

import { AUTH_COOKIE, AUTH_ENDPOINT, AUTH_HEADER } from '@/config/auth';
import { API_ERROR_COPY, TIMINGS } from '@/config/constants';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function requestErrorMessage(
  cause: unknown,
  fallback: string = API_ERROR_COPY.request,
): string {
  return cause instanceof Error && !(cause instanceof TypeError) ? cause.message : fallback;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Кука XSRF-TOKEN появляется после любого запроса к бэкенду;
// если её ещё нет - дёргаем bootstrap-эндпоинт.
async function csrfToken(signal: AbortSignal): Promise<string> {
  const existing = readCookie(AUTH_COOKIE.xsrf);
  if (existing) return existing;

  await fetchText(AUTH_ENDPOINT.csrf, { signal });
  return readCookie(AUTH_COOKIE.xsrf) ?? '';
}

interface ApiFetchInit extends RequestInit {
  json?: unknown;
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, signal, ...rest } = init;
  const method = (rest.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  const timeout = setTimeout(
    () => controller.abort(new DOMException(API_ERROR_COPY.timeout, 'TimeoutError')),
    TIMINGS.apiRequestTimeoutMs,
  );

  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    controller.signal.throwIfAborted();

    const headers = new Headers(rest.headers);
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    if (MUTATING_METHODS.has(method)) {
      headers.set(AUTH_HEADER.xsrf, await csrfToken(controller.signal));
    }

    const text = await fetchText(path, {
      ...rest,
      method,
      headers,
      signal: controller.signal,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    // Разбор ошибки может перехватить отмену; сохраняем причину тайм-аута или внешней отмены.
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function fetchText(path: string, init: RequestInit): Promise<string> {
  const response = await fetch(path, { ...init, credentials: 'include' });

  if (!response.ok) {
    // Бэкенд отвечает RFC 9457 problem detail - берём человекочитаемое поле.
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
      code?: string;
      requestId?: string;
    } | null;
    throw new ApiError(
      response.status,
      problem?.detail ?? API_ERROR_COPY.request,
      problem?.code,
      problem?.requestId,
    );
  }

  return response.text();
}

// Имитация сетевой задержки - для оставшихся мок-эндпоинтов.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
