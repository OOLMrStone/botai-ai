import type { Metadata } from 'next';

import { LegalIndex } from '@/components/legal/LegalIndex';
import { LEGAL_COPY } from '@/config/legal';

export const metadata: Metadata = { title: LEGAL_COPY.title, description: LEGAL_COPY.description };

export default function LegalPage() {
  return <LegalIndex />;
}
