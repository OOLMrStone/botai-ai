'use client';

import { ErrorNote } from '@/components/common/ErrorNote';
import { useStorefrontSession } from '@/hooks/use-storefront-session';
import { StorefrontAbout } from '@/components/storefront/StorefrontAbout';
import { StorefrontPricing } from '@/components/storefront/StorefrontPricing';
import { StorefrontFooter } from '@/components/storefront/StorefrontFooter';
import { StorefrontHero } from '@/components/storefront/StorefrontHero';
import { StorefrontNavigation } from '@/components/storefront/StorefrontNavigation';
import { StorefrontWorkflow } from '@/components/storefront/StorefrontWorkflow';
import { layout } from '@/config/layout';
import { STOREFRONT, STOREFRONT_COPY as COPY, STOREFRONT_THEME } from '@/config/storefront';

export function Storefront() {
  const { user, failed, retry } = useStorefrontSession();
  const entryHref = user ? STOREFRONT.account : STOREFRONT.start;
  const entryLabel = user ? COPY.continue : COPY.check;

  return (
    <div className={layout.storefront.root} style={STOREFRONT_THEME}>
      <a href={`#${STOREFRONT.main}`} className={layout.storefront.skip}>
        {COPY.skip}
      </a>
      <StorefrontNavigation user={user} entryHref={entryHref} entryLabel={entryLabel} />
      {failed ? (
        <div className={layout.storefront.sessionError}>
          <ErrorNote message={COPY.sessionError} onRetry={retry} />
        </div>
      ) : null}
      <main id={STOREFRONT.main}>
        <StorefrontHero
          entryHref={entryHref}
          entryLabel={entryLabel}
          showTrial={STOREFRONT.features.trial && !user}
        />
        {STOREFRONT.features.workflow ? <StorefrontWorkflow /> : null}
        <StorefrontPricing />
        <StorefrontAbout />
      </main>
      <StorefrontFooter />
    </div>
  );
}
