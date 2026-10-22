import type { Ref } from 'react';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import type { BillingOffer } from '@/lib/api/billing';
import { formatBillingAmount, isSubscriptionOffer } from '@/lib/billing';

export function BillingConsent({
  offer,
  accepted,
  disabled,
  onChange,
  inputRef,
}: {
  offer: BillingOffer;
  accepted: boolean;
  disabled: boolean;
  onChange: (accepted: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  if (!isSubscriptionOffer(offer)) return null;
  const amount = formatBillingAmount(offer.amount);
  return (
    <div className={layout.billing.consent}>
      <div className={layout.billing.resultStatus}>
        <p className={layout.billing.label}>{C.initialCharge(amount)}</p>
        <p>{C.recurringCharge(amount, offer.intervalDays)}</p>
        <p className={layout.billing.secondary}>{C.recurringQuota(offer.checkLimit)}</p>
      </div>
      <label className={layout.billing.consentLabel} htmlFor={C.consentId}>
        <input
          ref={inputRef}
          id={C.consentId}
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={layout.billing.checkbox}
        />
        <span>{C.consent(amount, offer.intervalDays)}</span>
      </label>
    </div>
  );
}
