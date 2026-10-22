'use client';

import { useRouter } from 'next/navigation';
import { BillingOfferSummary } from '@/components/billing/BillingOfferSummary';
import { BillingAccount } from '@/components/billing/BillingAccount';
import { BillingShell } from '@/components/billing/BillingShell';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import { ROUTES } from '@/config/onboarding-steps';
import { useBillingPayment } from '@/hooks/use-billing-payment';
import { confirmationUrl, hasTestAccess, isPendingPayment } from '@/lib/billing';

export function BillingReturn({ paymentId }: { paymentId: string | null }) {
  const router = useRouter();
  const result = useBillingPayment(paymentId);
  const payment = result.payment;
  const success = payment && hasTestAccess(payment);
  const canceled = payment?.status === 'canceled';
  const pending = payment && isPendingPayment(payment);
  const access =
    result.access?.mode === 'test' && result.access.testOnly === true ? result.access : null;
  const renewalFailed = canceled && payment?.purpose === 'subscription_renewal';
  const checkout =
    !result.error && payment?.status === 'pending'
      ? confirmationUrl(payment.confirmationUrl)
      : null;
  const title = success
    ? C.succeeded
    : renewalFailed
      ? C.renewalFailed
      : canceled
        ? C.canceled
        : pending
          ? payment.status === 'waiting_for_capture'
            ? C.waiting_for_capture
            : C.pending
          : C.review_required;
  const description = success
    ? C.succeededDescription
    : renewalFailed
      ? C.noAutomaticRetry
      : canceled
        ? C.canceledDescription
        : pending
          ? C.pendingDescription
          : C.reviewDescription;

  return (
    <BillingShell
      title={C.returnTitle}
      footer={
        <>
          {checkout ? (
            <Button size="multiline" onClick={() => window.location.assign(checkout)}>
              {C.openCheckout}
            </Button>
          ) : null}
          {paymentId && ((!success && !canceled) || result.error) ? (
            <Button
              size="multiline"
              variant="outline"
              disabled={result.checking}
              onClick={result.retry}
            >
              {result.checking ? C.checking : C.check}
            </Button>
          ) : null}
          {canceled && access?.canPurchase ? (
            <Button size="multiline" onClick={() => router.push(ROUTES.billingSandbox)}>
              {C.retryPurchase}
            </Button>
          ) : null}
          {success || (access?.subscription && !access.canPurchase) ? (
            <Button
              size="multiline"
              variant="outline"
              onClick={() => router.push(ROUTES.billingSandbox)}
            >
              {C.manageAction}
            </Button>
          ) : null}
          <Button
            size="multiline"
            variant={success ? 'default' : 'ghost'}
            onClick={() => router.push(ROUTES.home)}
          >
            {C.back}
          </Button>
          <p className={layout.billing.actionNote}>{C.accessScope}</p>
        </>
      }
    >
      <div className={layout.billing.result}>
        {payment ? (
          <div className={layout.billing.resultStatus} role="status">
            <p className={layout.billing.label}>{title}</p>
            <p className={layout.billing.secondary}>{description}</p>
          </div>
        ) : !result.error ? (
          <p role="status">{C.checking}</p>
        ) : null}
        {payment ? (
          <div className={layout.billing.offer}>
            <BillingOfferSummary offer={payment.offer} />
          </div>
        ) : null}
        {access ? (
          <BillingAccount
            status={access}
            onChange={result.updateSubscription}
            onRefresh={result.retry}
            paymentId={paymentId}
          />
        ) : null}
        {result.exhausted ? <p className={layout.billing.secondary}>{C.paused}</p> : null}
        {result.error ? <ErrorNote retrySize="multiline" message={result.error} /> : null}
      </div>
    </BillingShell>
  );
}
