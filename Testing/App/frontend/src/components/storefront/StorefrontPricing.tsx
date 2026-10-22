'use client';

import { ArrowUpRight, Check } from 'lucide-react';

import { BillingPeriodSwitch } from '@/components/common/BillingPeriodSwitch';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { StorefrontSectionIntro } from '@/components/storefront/StorefrontSectionIntro';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { STOREFRONT, STOREFRONT_COPY as COPY } from '@/config/storefront';
import { useStorefrontPricing } from '@/hooks/use-storefront-pricing';
import { cn } from '@/lib/utils';

export function StorefrontPricing() {
  const { period, setPeriod, plans } = useStorefrontPricing();

  return (
    <section id={STOREFRONT.sections.pricing} className={layout.storefront.pricingSurface}>
      <div className={layout.storefront.pricingHeader}>
        <div className={cn(layout.storefront.container, layout.storefront.pricingHeaderGrid)}>
          <div className={cn(layout.storefront.container, layout.storefront.pricingIntro)}>
            <StorefrontSectionIntro {...COPY.pricing} />
          </div>
          <div className={cn(layout.storefront.container, layout.storefront.pricingToolbar)}>
            <div className={layout.storefront.pricingBenefits}>
              <p className={cn(layout.storefront.pricingBenefit, layout.storefront.freePractice)}>
                <Check className={layout.storefront.smallIcon} aria-hidden />
                {COPY.pricing.free}
              </p>
              <p className={cn(layout.storefront.pricingBenefit, layout.storefront.trialBenefit)}>
                <Check className={layout.storefront.smallIcon} aria-hidden />
                <span>
                  {COPY.pricing.trial}
                  {!STOREFRONT.features.trial ? (
                    <span className={layout.storefront.trialStatus}>
                      {COPY.pricing.trialStatus}
                    </span>
                  ) : null}
                </span>
              </p>
            </div>
            <BillingPeriodSwitch
              value={period}
              onChange={setPeriod}
              className={layout.storefront.periods}
            />
          </div>
        </div>
      </div>
      <div className={cn(layout.storefront.container, layout.storefront.pricingBody)}>
        <div className={layout.storefront.pricingGrid}>
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={cn(
                layout.storefront.priceCard,
                plan.recommended && layout.storefront.priceRecommended,
              )}
            >
              {plan.recommended ? (
                <span className={layout.storefront.priceBadge}>{COPY.pricing.recommendation}</span>
              ) : null}
              <div className={layout.storefront.priceHeading}>
                <ScreenHeading as="h3" variant="landingCard" title={plan.name} />
              </div>
              <div className={layout.storefront.priceAmount}>
                <p className={layout.storefront.priceValue}>{plan.price}</p>
                <p className={layout.storefront.priceUnit}>{COPY.pricing.monthlyEquivalentUnit}</p>
              </div>
              {plan.payment ? (
                <p className={layout.storefront.pricePayment}>{plan.payment}</p>
              ) : null}
              <p className={layout.storefront.priceQuota}>
                <Check className={layout.storefront.smallIcon} aria-hidden />
                {COPY.pricing.checksIncluded(plan.quota)}
              </p>
              <p className={layout.storefront.priceDetails}>{COPY.pricing.details}</p>
              <Button
                variant="storefrontDark"
                size="default"
                className={cn(layout.storefront.action, layout.storefront.priceAction)}
                disabled
                disabledReason={COPY.pricing.checkoutUnavailable}
              >
                {COPY.pricing.action}
                <ArrowUpRight className={layout.storefront.smallIcon} aria-hidden />
              </Button>
            </article>
          ))}
        </div>
        <p className={layout.storefront.pricingNote}>
          {period === 'season'
            ? `${COPY.pricing.seasonNote} ${COPY.pricing.seasonEquivalentNote}`
            : COPY.pricing.monthNote}
        </p>
      </div>
    </section>
  );
}
