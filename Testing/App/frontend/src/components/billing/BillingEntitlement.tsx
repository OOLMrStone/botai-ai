import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import type { ReactNode } from 'react';
import type { BillingEntitlement as Entitlement, BillingSubscription } from '@/lib/api/billing';
import { formatBillingDate } from '@/lib/billing';

export function BillingEntitlement({
  entitlement,
  subscription,
  children,
}: {
  entitlement?: Entitlement | null;
  subscription?: BillingSubscription | null;
  children?: ReactNode;
}) {
  const plan = entitlement?.plan ?? subscription?.offer.plan;
  const paidThrough = subscription?.paidThrough ?? entitlement?.expiresAt;
  return (
    <div className={layout.billing.status}>
      <p className={layout.billing.label}>{plan ? C.plans[plan] : C.active}</p>
      <p>
        {entitlement
          ? C.remaining(entitlement.checksRemaining, entitlement.checksTotal)
          : C.noPaidAccess}
      </p>
      {entitlement && entitlement.checksReserved > 0 ? (
        <p className={layout.billing.secondary}>{C.reserved(entitlement.checksReserved)}</p>
      ) : null}
      {paidThrough ? (
        <p className={layout.billing.secondary}>{C.expires(formatBillingDate(paidThrough))}</p>
      ) : null}
      {children}
    </div>
  );
}
