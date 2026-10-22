import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/onboarding/Wordmark';
import { LEGAL_COPY } from '@/config/legal';
import { layout } from '@/config/layout';
import { ROUTES } from '@/config/onboarding-steps';
import { STOREFRONT_COPY, STOREFRONT_THEME } from '@/config/storefront';

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className={layout.storefront.root} style={STOREFRONT_THEME}>
      <div className={layout.legal.container}>
        <header className={layout.legal.header}>
          <Link
            href={ROUTES.storefront}
            aria-label={STOREFRONT_COPY.home}
            className={layout.storefront.brandLink}
          >
            <Wordmark variant="compact" />
          </Link>
          <Link href={ROUTES.storefront} className={layout.storefront.navLink}>
            {LEGAL_COPY.back}
          </Link>
        </header>
        <main className={layout.legal.main}>{children}</main>
      </div>
    </div>
  );
}
