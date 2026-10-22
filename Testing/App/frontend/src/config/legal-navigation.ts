import type { LegalDocumentId } from '@/config/legal';

const PRIVACY_LINK = { document: 'privacy', label: 'Политика конфиденциальности' } as const;

export const LEGAL_AUTH_NOTICE = {
  prefix: {
    register: 'Совершая регистрацию, вы соглашаетесь с',
    login: 'Совершая вход, вы соглашаетесь с',
  },
  links: [
    { document: 'terms', label: 'Пользовательским соглашением', separator: '' },
    { document: 'offer', label: 'Публичной офертой', separator: ', ' },
    { document: 'privacy', label: 'Политикой конфиденциальности', separator: ' и ' },
  ],
  end: '.',
} as const;

export const LEGAL_PAYWALL_LINKS = [
  { document: 'offer', label: 'Оферта' },
  PRIVACY_LINK,
] as const satisfies readonly { document: LegalDocumentId; label: string }[];

export const LEGAL_ROBOTS = { index: true, follow: true } as const;
