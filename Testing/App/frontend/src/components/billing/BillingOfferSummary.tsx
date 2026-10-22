import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import type { BillingOffer } from '@/lib/api/billing';
import { billingOfferTerm, formatBillingAmount, isSubscriptionOffer } from '@/lib/billing';

export function BillingOfferSummary({
  offer,
  checkout = false,
}: {
  offer: BillingOffer;
  checkout?: boolean;
}) {
  return (
    <span className={layout.billing.offerBody}>
      <span className={layout.billing.offerHeading}>
        <span className={layout.billing.offerTitle}>{C.plans[offer.plan]}</span>
        <span className={layout.billing.secondary}>{C.periods[offer.period]}</span>
      </span>
      <span className={layout.billing.offerPrice}>
        <span className={layout.billing.price}>{formatBillingAmount(offer.amount)}</span>
        <span className={layout.billing.quota}>{C.checks(offer.checkLimit)}</span>
      </span>
      <span className={layout.billing.term}>
        <span>{billingOfferTerm(offer)}</span>
        {isSubscriptionOffer(offer) ? (
          checkout ? (
            <span>{C.recurringCharge(formatBillingAmount(offer.amount), offer.intervalDays)}</span>
          ) : null
        ) : (
          <span>{C.conditions}</span>
        )}
        {offer.period === 'season' ? <span>{C.seasonQuota}</span> : null}
      </span>
    </span>
  );
}
