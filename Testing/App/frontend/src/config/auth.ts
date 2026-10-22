// Имена куки и CSRF-заголовка - контракт с бэкендом (Spring). Одно место для
// клиента (lib/api/client) и локального мок-бэкенда (app/api/auth/_mock),
// чтобы они не разъехались.

export const AUTH_COOKIE = {
  session: 'SESSION',
  xsrf: 'XSRF-TOKEN',
} as const;

export const AUTH_HEADER = {
  xsrf: 'X-XSRF-TOKEN',
} as const;

export const AUTH_ENDPOINT = {
  csrf: '/api/auth/csrf',
} as const;

export const LOGIN_FORM_ID = 'login-form';
export const REGISTER_FORM_ID = 'register-form';
export const PASSWORD_MIN_LENGTH = 8;

export const EMPTY_REGISTRATION = {
  displayName: '',
  email: '',
  password: '',
};

export const AUTH_COPY = {
  displayName: 'Как к тебе обращаться',
  email: 'Почта',
  password: 'Пароль',
  alternative: 'или',
  signingIn: 'Входим',
  registering: 'Создаём профиль',
} as const;

export const REGISTER_FIELDS = [
  { name: 'displayName', autoComplete: 'nickname', type: 'text', error: 'name' },
  { name: 'email', autoComplete: 'email', type: 'email', error: 'email' },
  { name: 'password', autoComplete: 'new-password', type: 'password', error: 'password' },
] as const;
