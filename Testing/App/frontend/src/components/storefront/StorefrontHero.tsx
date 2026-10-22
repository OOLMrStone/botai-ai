import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { StorefrontAction } from '@/components/storefront/StorefrontAction';
import { StorefrontGraph } from '@/components/storefront/StorefrontGraph';
import { layout } from '@/config/layout';
import { STOREFRONT_COPY as COPY } from '@/config/storefront';
import { cn } from '@/lib/utils';

export function StorefrontHero({
  entryHref,
  entryLabel,
  showTrial,
}: {
  entryHref: string;
  entryLabel: string;
  showTrial: boolean;
}) {
  return (
    <section className={cn(layout.storefront.container, layout.storefront.hero)}>
      <div className={layout.storefront.heroContent}>
        <ScreenHeading variant="landingHero" title={COPY.hero.title} />
        <p className={layout.storefront.heroDescription}>{COPY.hero.description}</p>
        <div className={layout.storefront.heroActions}>
          <StorefrontAction href={entryHref} tone="dark">
            {entryLabel}
          </StorefrontAction>
          {showTrial ? (
            <p className={layout.storefront.trial}>
              <strong>{COPY.trial}</strong>
              <span>{COPY.trialDetails}</span>
            </p>
          ) : null}
        </div>
      </div>
      <StorefrontGraph />
    </section>
  );
}
