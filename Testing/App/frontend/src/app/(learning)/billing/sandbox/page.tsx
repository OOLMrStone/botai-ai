import { BillingGate } from '@/components/billing/BillingShell';
import { BillingSandbox } from '@/components/billing/BillingSandbox';
import { ROUTES } from '@/config/onboarding-steps';

export default function BillingSandboxPage() {
  return (
    <BillingGate returnTo={ROUTES.billingSandbox}>
      <BillingSandbox />
    </BillingGate>
  );
}
