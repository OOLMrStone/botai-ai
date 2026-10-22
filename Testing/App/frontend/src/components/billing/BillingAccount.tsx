import { BillingEntitlement } from '@/components/billing/BillingEntitlement';
import { BillingSubscription } from '@/components/billing/BillingSubscription';
import { BillingInFlight } from '@/components/billing/BillingInFlight';
import { layout } from '@/config/layout';
import type { BillingStatus, BillingSubscription as Subscription } from '@/lib/api/billing';

export function BillingAccount({
  status,
  onChange,
  onRefresh,
  paymentId,
  actionPaymentId,
}: {
  status: BillingStatus;
  onChange: (subscription: Subscription) => void;
  onRefresh: () => void;
  paymentId?: string | null;
  actionPaymentId?: string | null;
}) {
  if (!status.entitlement && !status.subscription) return null;
  const inFlight = status.subscription?.inFlightPaymentId;
  return (
    <div className={layout.billing.result}>
      <BillingEntitlement entitlement={status.entitlement} subscription={status.subscription}>
        {status.subscription ? (
          <BillingSubscription
            subscription={status.subscription}
            onChange={onChange}
            onRefresh={onRefresh}
          />
        ) : null}
      </BillingEntitlement>
      {inFlight && inFlight !== paymentId ? (
        <BillingInFlight paymentId={inFlight} showAction={inFlight !== actionPaymentId} />
      ) : null}
    </div>
  );
}
