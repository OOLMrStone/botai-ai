import Link from 'next/link';

import { LEGAL_COPY, LEGAL_DOCUMENTS } from '@/config/legal';
import { layout } from '@/config/layout';
import { legalPath } from '@/config/onboarding-steps';

export function LegalLinks() {
  return (
    <nav aria-label={LEGAL_COPY.navigationLabel} className={layout.legal.links}>
      {LEGAL_DOCUMENTS.map((document) => (
        <Link key={document.id} href={legalPath(document.id)} className={layout.legal.footerLink}>
          {document.title}
        </Link>
      ))}
    </nav>
  );
}
