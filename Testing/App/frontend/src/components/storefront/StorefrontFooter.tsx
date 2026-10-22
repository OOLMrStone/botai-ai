import Image from 'next/image';

import { Wordmark } from '@/components/onboarding/Wordmark';
import { layout } from '@/config/layout';
import { STOREFRONT, STOREFRONT_COPY as COPY } from '@/config/storefront';

export function StorefrontFooter() {
  return (
    <footer id={STOREFRONT.sections.contacts} className={layout.storefront.footer}>
      <div className={layout.storefront.container}>
        <div className={layout.storefront.footerGrid}>
          <div className={layout.storefront.footerColumn}>
            <a
              href={STOREFRONT.home}
              aria-label={COPY.home}
              className={layout.storefront.brandLink}
            >
              <Image {...STOREFRONT.logo} alt="" className={layout.storefront.brandIcon} />
              <Wordmark variant="compact" />
            </a>
            <p className={layout.storefront.footerDescription}>{COPY.footer.description}</p>
          </div>
          <div className={layout.storefront.footerColumn}>
            <p className={layout.storefront.footerLabel}>{COPY.footer.contactTitle}</p>
            {STOREFRONT.contacts.map((contact) => (
              <a key={contact.href} href={contact.href} className={layout.storefront.footerEmail}>
                {contact.label}
              </a>
            ))}
          </div>
        </div>
        <div className={layout.storefront.footerBottom}>
          <span>{COPY.footer.legal}</span>
          <span>{COPY.footer.taxId}</span>
        </div>
      </div>
    </footer>
  );
}
