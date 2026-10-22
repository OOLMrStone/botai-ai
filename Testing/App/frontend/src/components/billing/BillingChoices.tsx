import { ChevronDown } from 'lucide-react';
import { BillingOfferCard } from '@/components/billing/BillingOfferCard';
import { BillingPeriodSwitch } from '@/components/common/BillingPeriodSwitch';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import type { useBillingSandbox } from '@/hooks/use-billing-sandbox';

export function BillingChoices({ billing }: { billing: ReturnType<typeof useBillingSandbox> }) {
  return (
    <>
      <BillingPeriodSwitch
        value={billing.period}
        onChange={billing.changePeriod}
        className={layout.billing.periods}
      />
      <div id={C.plansId} className={layout.billing.offers} role="group" aria-label={C.select}>
        {billing.periodOffers.map((offer) => (
          <BillingOfferCard
            key={offer.id}
            offer={offer}
            selected={billing.selected === offer.id}
            collapsed={!billing.expanded && billing.selected !== offer.id}
            pending={billing.pending}
            onSelect={() => billing.select(offer.id)}
            ref={billing.selected === offer.id ? billing.selectedRef : undefined}
          />
        ))}
      </div>
      {!billing.expanded ? (
        <button
          type="button"
          className={layout.billing.other}
          aria-controls={C.plansId}
          aria-expanded={false}
          onClick={billing.expand}
        >
          {C.otherPlans}
          <ChevronDown className={layout.billing.check} aria-hidden />
        </button>
      ) : null}
    </>
  );
}
