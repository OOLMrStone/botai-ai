'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/common/ErrorNote';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import { useBillingPayment } from '@/hooks/use-billing-payment';
import { billingReturnPath, formatBillingAmount, isPendingPayment } from '@/lib/billing';

export function BillingInFlight({
  paymentId,
  showAction = true,
}: {
  paymentId: string;
  showAction?: boolean;
}) {
  const router = useRouter();
  const result = useBillingPayment(paymentId);
  const payment = result.payment;
  return (
    <div className={layout.billing.resultStatus} role="status">
      <p className={layout.billing.secondary}>
        {!payment || isPendingPayment(payment)
          ? C.inFlight
          : payment.status === 'succeeded'
            ? C.succeeded
            : payment.status === 'canceled'
              ? C.canceled
              : C.reviewDescription}
      </p>
      {payment ? (
        <p className={layout.billing.label}>
          {C.inFlightAmount(formatBillingAmount(payment.amount))}
        </p>
      ) : null}
      {result.error ? <ErrorNote retrySize="multiline" message={result.error} /> : null}
      {showAction ? (
        <Button
          size="multiline"
          variant="outline"
          onClick={() => router.push(billingReturnPath(paymentId))}
        >
          {C.checkPayment}
        </Button>
      ) : null}
    </div>
  );
}
