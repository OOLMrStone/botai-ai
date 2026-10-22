import { BillingGate } from '@/components/billing/BillingShell';
import { BillingReturn } from '@/components/billing/BillingReturn';
import { BILLING } from '@/config/billing';
import { ROUTES } from '@/config/onboarding-steps';
import { billingReturnPath, isPaymentId } from '@/lib/billing';

export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = (await searchParams)[BILLING.paymentQuery];
  const paymentId = typeof value === 'string' && isPaymentId(value) ? value : null;
  return (
    <BillingGate returnTo={paymentId ? billingReturnPath(paymentId) : ROUTES.billingSandbox}>
      <BillingReturn paymentId={paymentId} />
    </BillingGate>
  );
}
