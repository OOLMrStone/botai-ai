import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { layout } from '@/config/layout';
import { PAYWALL_COPY as C, type PaywallPeriod, type PaywallPlan } from '@/config/paywall';
import { paywallPrice, paywallDailyPrice } from '@/lib/paywall';
import { cn } from '@/lib/utils';

export function PaywallPlanCard({
  plan,
  period,
  selected,
  chosen,
  onSelect,
  ref,
}: {
  plan: PaywallPlan;
  period: PaywallPeriod;
  selected: boolean;
  chosen: boolean;
  onSelect: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const price = paywallPrice(plan, period);
  const daily = period === 'season' ? paywallDailyPrice(plan) : null;
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(layout.paywall.card, selected && layout.paywall.cardSelected)}
    >
      {selected ? (
        <span className={layout.paywall.badge}>{chosen ? C.selected : C.recommended}</span>
      ) : null}
      <span
        aria-hidden="true"
        className={cn(layout.paywall.radio, selected && layout.paywall.radioSelected)}
      >
        <Check className={layout.paywall.check} />
      </span>
      <span className={layout.paywall.title}>{plan.name}</span>
      <span className={layout.paywall.pricing}>
        <span key={period} className={cn(layout.paywall.priceGroup, layout.paywall.priceChange)}>
          <span className={layout.paywall.price}>
            {price.total} {C.currency}
          </span>
          <span className={layout.paywall.pricePeriod}>{C.pricePeriod[period]}</span>
        </span>
        <span className={layout.paywall.quota}>
          <Check aria-hidden="true" className={layout.paywall.quotaIcon} />
          <span>{C.quota(price.checks, period)}</span>
        </span>
      </span>
      {period === 'season' ? (
        <span className={layout.paywall.footer}>
          <span className={layout.paywall.charge}>{C.packageAvailable}</span>
          {daily ? (
            <span className={layout.paywall.dailyPrice} title={C.dailyEquivalent(daily.days)}>
              <span>
                {daily.amount} {C.currency}
              </span>
              <span className={layout.paywall.dailyUnit}>{C.perDay}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
