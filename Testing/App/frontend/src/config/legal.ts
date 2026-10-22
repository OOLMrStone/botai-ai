import { LEGAL_CONSENT } from '@/config/legal-consent';
import { LEGAL_COOKIES } from '@/config/legal-cookies';
import { LEGAL_OFFER } from '@/config/legal-offer';
import { LEGAL_PRIVACY } from '@/config/legal-privacy';
import { LEGAL_TERMS } from '@/config/legal-terms';

export type LegalDocumentId = 'privacy' | 'terms' | 'offer' | 'consent' | 'cookies';

export type LegalDocument = {
  id: LegalDocumentId;
  title: string;
  summary: string;
  sections: readonly { title: string; paragraphs: readonly string[] }[];
};

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  LEGAL_PRIVACY,
  LEGAL_TERMS,
  LEGAL_OFFER,
  LEGAL_CONSENT,
  LEGAL_COOKIES,
];

export const LEGAL_COPY = {
  title: 'Документы',
  description: 'Правила сервиса, оплата и обработка данных - в одном месте',
  back: 'На главную',
  updatedAt: 'Редакция от 7 октября 2026 года',
  navigationLabel: 'Юридические документы',
} as const;
