import Link from 'next/link';

import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { LEGAL_COPY, LEGAL_DOCUMENTS } from '@/config/legal';
import { layout } from '@/config/layout';
import { legalPath } from '@/config/onboarding-steps';

export function LegalIndex() {
  return (
    <>
      <div className={layout.legal.intro}>
        <ScreenHeading title={LEGAL_COPY.title} subtitle={LEGAL_COPY.description} variant="app" />
        <p className={layout.storefront.helper}>{LEGAL_COPY.updatedAt}</p>
      </div>
      <nav aria-label={LEGAL_COPY.navigationLabel} className={layout.legal.list}>
        {LEGAL_DOCUMENTS.map((document) => (
          <div key={document.id} className={layout.legal.item}>
            <Link href={legalPath(document.id)} className={layout.legal.documentLink}>
              {document.title}
            </Link>
            <p className={layout.storefront.helper}>{document.summary}</p>
          </div>
        ))}
      </nav>
    </>
  );
}
