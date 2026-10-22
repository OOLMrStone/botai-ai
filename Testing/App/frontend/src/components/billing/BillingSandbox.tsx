'use client';

import { BillingChoices } from '@/components/billing/BillingChoices';
import { BillingConsent } from '@/components/billing/BillingConsent';
import { BillingAccount } from '@/components/billing/BillingAccount';
import { BillingOfferSummary } from '@/components/billing/BillingOfferSummary';
import { BillingShell } from '@/components/billing/BillingShell';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Button } from '@/components/ui/button';
import { BILLING_COPY as C } from '@/config/billing';
import { layout } from '@/config/layout';
import { useBillingSandbox } from '@/hooks/use-billing-sandbox';

export function BillingSandbox() {
  const billing = useBillingSandbox();
  return (
    <BillingShell
      title={
        billing.status &&
        !billing.status.canPurchase &&
        (billing.status.entitlement || billing.status.subscription)
          ? C.manage
          : C.title
      }
      footer={
        billing.available ? (
          <>
            {billing.error ? (
              <ErrorNote retrySize="multiline" message={billing.error} onRetry={billing.retry} />
            ) : null}
            <Button
              size="multiline"
              className={layout.cta}
              disabled={billing.pending || !billing.canSubmit}
              onClick={() => void billing.submit()}
            >
              {billing.pending
                ? C.creating
                : billing.resumePaymentId
                  ? C.checkPayment
                  : billing.recovering
                    ? C.resume
                    : billing.consentNeeded
                      ? C.subscribe
                      : C.pay}
            </Button>
            {billing.consentNeeded && !billing.consentAccepted ? (
              <button
                type="button"
                className={layout.billing.consentPrompt}
                aria-controls={C.consentId}
                onClick={billing.focusConsent}
              >
                {C.consentPrompt}
              </button>
            ) : (
              <p className={layout.billing.actionNote}>{C.accessScope}</p>
            )}
          </>
        ) : null
      }
    >
      {!billing.catalog ? (
        billing.error ? (
          <ErrorNote retrySize="multiline" message={billing.error} onRetry={billing.retry} />
        ) : (
          <p role="status">{C.loading}</p>
        )
      ) : !billing.enabled ? (
        <div className={layout.billing.result}>
          <p role="status" className={layout.billing.secondary}>
            {C.unavailable}
          </p>
        </div>
      ) : (
        <>
          {billing.error && !billing.available ? (
            <div className={layout.billing.result}>
              <ErrorNote
                retrySize="multiline"
                message={billing.error === C.loadError ? C.refreshError : billing.error}
                onRetry={billing.retry}
              />
            </div>
          ) : null}
          {billing.status ? (
            <BillingAccount
              status={billing.status}
              onChange={billing.updateSubscription}
              onRefresh={billing.retry}
              actionPaymentId={billing.available ? billing.resumePaymentId : null}
            />
          ) : null}
          {billing.recovering && !billing.status?.subscription && !billing.status?.entitlement ? (
            <div className={layout.billing.result}>
              <p className={layout.billing.secondary}>{C.recovery}</p>
              {!billing.resumePaymentId && billing.selectedOffer ? (
                <div className={layout.billing.offer}>
                  <BillingOfferSummary offer={billing.selectedOffer} />
                </div>
              ) : null}
            </div>
          ) : !billing.recovering && billing.status?.canPurchase ? (
            <>
              <BillingChoices billing={billing} />
              {billing.consentNeeded && billing.selectedOffer ? (
                <BillingConsent
                  offer={billing.selectedOffer}
                  accepted={billing.consentAccepted}
                  disabled={billing.pending}
                  onChange={billing.acceptConsent}
                  inputRef={billing.consentRef}
                />
              ) : null}
            </>
          ) : !billing.status?.subscription &&
            !billing.status?.entitlement &&
            !billing.recovering ? (
            <p role="status" className={layout.billing.secondary}>
              {C.blocked}
            </p>
          ) : null}
        </>
      )}
    </BillingShell>
  );
}
