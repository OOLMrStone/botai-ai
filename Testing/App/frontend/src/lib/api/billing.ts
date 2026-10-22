import { IS_MOCK_API } from '@/config/env';
import { ApiError, apiFetch } from '@/lib/api/client';
import type { User } from '@/lib/api/auth';
import type { PlanId } from '@/config/plans';
import { BILLING } from '@/config/billing';

export interface BillingAmount {
  value: string;
  currency: 'RUB';
}
export interface BillingOffer {
  id: string;
  kind: 'one_time' | 'subscription';
  plan: 'light' | 'core' | 'heavy';
  period: 'month' | 'season';
  amount: BillingAmount;
  checkLimit: number;
  durationDays?: number | null;
  expiresAt?: string | null;
  autoRenew: boolean;
  intervalDays?: number | null;
  consentVersion?: string | null;
}
export interface BillingOffers {
  mode: 'disabled' | 'test';
  testOnly: true;
  offers: BillingOffer[];
}
export type PaymentStatus =
  'creating' | 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled' | 'review_required';
export interface BillingPayment {
  id: string;
  offerId: string;
  offer: BillingOffer;
  status: PaymentStatus;
  amount: BillingAmount;
  test: true;
  confirmationUrl?: string | null;
  entitlementApplied: boolean;
  createdAt: string;
  purpose: 'one_time' | 'subscription_initial' | 'subscription_renewal';
  subscriptionId?: string | null;
  periodSequence?: number | null;
  cancellationReason?: string | null;
}
export interface BillingEntitlement {
  plan: BillingOffer['plan'];
  startsAt: string;
  expiresAt: string;
  checksTotal: number;
  checksUsed: number;
  checksReserved: number;
  checksRemaining: number;
}
export interface BillingPeriod extends Omit<BillingEntitlement, 'plan'> {
  sequence: number;
}
export interface BillingSubscription {
  id: string;
  status: 'pending_initial' | 'active' | 'payment_failed' | 'canceled' | 'review_required';
  renewalEnabled: boolean;
  offer: BillingOffer;
  currentPeriod?: BillingPeriod | null;
  nextPaymentAt?: string | null;
  paidThrough?: string | null;
  currentPaymentId?: string | null;
  inFlightPaymentId?: string | null;
  actionRequired?: string | null;
}
export interface BillingConsent {
  accepted: true;
  version: string;
}
export interface BillingStatus {
  mode: 'disabled' | 'test';
  testOnly: true;
  entitlement?: BillingEntitlement | null;
  canPurchase: boolean;
  currentPaymentId?: string | null;
  subscription?: BillingSubscription | null;
}

const paymentPath = (id: string) => `${BILLING.paymentsPath}/${encodeURIComponent(id)}`;
export const fetchBillingOffers = (signal?: AbortSignal) =>
  apiFetch<BillingOffers>(BILLING.offersPath, { signal });
export const fetchBillingStatus = (signal?: AbortSignal) =>
  apiFetch<BillingStatus>(BILLING.statusPath, { signal });
export const createTestPayment = (offerId: string, key: string) =>
  apiFetch<BillingPayment>(BILLING.paymentsPath, {
    headers: { [BILLING.idempotencyHeader]: key },
    json: { offerId },
  });
export const fetchTestPayment = (id: string, signal?: AbortSignal) =>
  apiFetch<BillingPayment>(paymentPath(id), { signal });
export const refreshTestPayment = (id: string, signal?: AbortSignal) =>
  apiFetch<BillingPayment>(`${paymentPath(id)}/refresh`, { method: 'POST', signal });
export const createTestSubscription = (offerId: string, key: string, consent: BillingConsent) =>
  apiFetch<{ subscription: BillingSubscription; payment: BillingPayment }>(
    BILLING.subscriptionsPath,
    {
      headers: { [BILLING.idempotencyHeader]: key },
      json: { offerId, consent },
    },
  );
export const cancelTestSubscription = (id: string) =>
  apiFetch<BillingSubscription>(`${BILLING.subscriptionsPath}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });

// Прямая смена тарифа доступна только старым локальным mock-инструментам.
export async function changePlan(plan: PlanId): Promise<User> {
  if (!IS_MOCK_API) throw new ApiError(403, 'Изменение тарифа недоступно');
  return apiFetch<User>('/api/billing/plan', { json: { plan } });
}
