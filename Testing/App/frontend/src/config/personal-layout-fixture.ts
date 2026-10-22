export const PERSONAL_LAYOUT_FIXTURE = {
  endpoint: '/local-presentation-fixture',
  sessionCookieName: 'B2B_SESSION',
  maxSessionCookieBytes: 4096,
  maxJsonBytes: 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  timeoutMs: 6_000,
  runLimit: 50,
  maxRunPages: 3,
  imageCount: 1,
  revision: 0,
} as const;
