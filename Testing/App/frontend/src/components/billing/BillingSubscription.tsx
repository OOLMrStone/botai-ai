'use client';

import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { DialogSheet } from '@/components/ui/dialog';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import { useBillingSubscription } from '@/hooks/use-billing-subscription';
import type { BillingSubscription as Subscription } from '@/lib/api/billing';
import { formatBillingAmount, formatBillingDate } from '@/lib/billing';

export function BillingSubscription({
  subscription,
  onChange,
  onRefresh,
}: {
  subscription: Subscription;
  onChange: (subscription: Subscription) => void;
  onRefresh: () => void;
}) {
  const { open, changeOpen, pending, error, cancel, canCancel, triggerRef, backRef } =
    useBillingSubscription(subscription, onChange);
  const paidThrough = subscription.paidThrough && formatBillingDate(subscription.paidThrough);
  return (
    <div className={layout.billing.subscription}>
      <div className={layout.billing.resultStatus} role="status">
        <p className={layout.billing.label}>
          {subscription.status === 'pending_initial'
            ? C.subscriptionPending
            : subscription.status === 'payment_failed'
              ? C.renewalFailed
              : subscription.actionRequired === 'payment_method_required'
                ? C.renewalNotConnected
                : subscription.renewalEnabled
                  ? C.renewalOn
                  : C.renewalOff}
        </p>
        {subscription.status === 'payment_failed' ? (
          <p className={layout.billing.secondary}>{C.noAutomaticRetry}</p>
        ) : null}
        {subscription.actionRequired === 'payment_method_required' ? (
          <p className={layout.billing.secondary}>{C.renewalNotConnectedDescription}</p>
        ) : null}
        {subscription.status === 'review_required' ? (
          <p className={layout.billing.secondary}>{C.reviewDescription}</p>
        ) : null}
        {subscription.renewalEnabled && subscription.nextPaymentAt ? (
          <p className={layout.billing.secondary}>
            {C.nextCharge(
              formatBillingAmount(subscription.offer.amount),
              formatBillingDate(subscription.nextPaymentAt),
            )}
          </p>
        ) : null}
      </div>
      <Button
        size="multiline"
        ref={triggerRef}
        variant="outline"
        onClick={canCancel ? () => changeOpen(true) : onRefresh}
      >
        {canCancel ? C.cancelRenewal : C.refreshAccess}
      </Button>
      <DialogSheet
        className={layout.billing.cancelSheet}
        open={open}
        title={C.cancelTitle}
        closeLabel={C.cancelClose}
        initialFocus={backRef}
        onOpenChange={changeOpen}
      >
        <div className={layout.billing.cancelForm}>
          <p className={layout.billing.secondary}>
            {paidThrough ? C.cancelPaidThrough(paidThrough) : C.cancelDescription}
          </p>
          {subscription.inFlightPaymentId ? (
            <p className={layout.billing.secondary}>{C.cancelInFlight}</p>
          ) : null}
          {error ? (
            <ErrorNote
              retrySize="multiline"
              message={error}
              onRetry={() => {
                changeOpen(false);
                onRefresh();
              }}
            />
          ) : null}
          <div className={layout.billing.cancelActions}>
            <Button
              size="multiline"
              ref={backRef}
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              {C.cancelClose}
            </Button>
            <Button size="multiline" disabled={pending} onClick={() => void cancel()}>
              {pending ? C.cancelPending : C.cancelConfirm}
            </Button>
          </div>
        </div>
      </DialogSheet>
    </div>
  );
}
