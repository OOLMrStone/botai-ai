import { Check } from 'lucide-react';
import type { Ref } from 'react';
import { BillingOfferSummary } from '@/components/billing/BillingOfferSummary';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import type { BillingOffer } from '@/lib/api/billing';
import { cn } from '@/lib/utils';

export function BillingOfferCard({
  offer,
  selected,
  collapsed,
  pending,
  onSelect,
  ref,
}: {
  offer: BillingOffer;
  selected: boolean;
  collapsed: boolean;
  pending: boolean;
  onSelect: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      disabled={pending}
      onClick={onSelect}
      className={cn(
        layout.billing.offer,
        selected && layout.billing.selected,
        collapsed && layout.billing.collapsedOffer,
      )}
    >
      <span
        aria-hidden
        className={cn(layout.billing.radio, selected && layout.billing.radioSelected)}
      >
        <Check className={layout.billing.check} />
      </span>
      <BillingOfferSummary offer={offer} checkout />
      {selected ? (
        <span className={layout.disabledAction.hiddenDescription}>{C.selected}</span>
      ) : null}
    </button>
  );
}
