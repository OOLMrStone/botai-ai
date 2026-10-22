import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LegalShell } from '@/components/legal/LegalShell';
import { LEGAL_ROBOTS } from '@/config/legal-navigation';

export const metadata: Metadata = { robots: LEGAL_ROBOTS };

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
