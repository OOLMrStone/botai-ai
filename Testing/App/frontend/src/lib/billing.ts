import { BILLING, BILLING_COPY as C } from '@/config/billing';
import { ROUTES } from '@/config/onboarding-steps';
import type {
  BillingAmount,
  BillingOffer,
  BillingPayment,
  BillingSubscription,
} from '@/lib/api/billing';

export function isSubscriptionOffer(offer: BillingOffer): offer is BillingOffer & {
  intervalDays: number;
  consentVersion: string;
} {
  return (
    offer.kind === 'subscription' &&
    offer.autoRenew === true &&
    typeof offer.intervalDays === 'number' &&
    offer.intervalDays > 0 &&
    typeof offer.consentVersion === 'string' &&
    offer.consentVersion.length > 0
  );
}
export const isBillingOffer = (offer: BillingOffer) =>
  isSubscriptionOffer(offer) || (offer.kind === 'one_time' && offer.autoRenew === false);

export function assertBillingSubscription(subscription: BillingSubscription) {
  if (
    !isPaymentId(subscription.id) ||
    !subscription.offer ||
    !isSubscriptionOffer(subscription.offer)
  )
    throw new Error(C.verificationError);
  return subscription;
}

export const isPaymentId = (value: string) => BILLING.uuidPattern.test(value);
export const billingReturnPath = (id: string) =>
  `${ROUTES.billingReturn}?${BILLING.paymentQuery}=${encodeURIComponent(id)}`;
export const isPendingPayment = (payment: BillingPayment) =>
  ['creating', 'pending', 'waiting_for_capture'].includes(payment.status);
export const hasTestAccess = (payment: BillingPayment) =>
  payment.test === true && payment.status === 'succeeded' && payment.entitlementApplied === true;

export function confirmationUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      BILLING.confirmationHosts.some((host) => host === url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function assertTestPayment(payment: BillingPayment): BillingPayment {
  if (
    payment.test !== true ||
    !isPaymentId(payment.id) ||
    !payment.offer ||
    payment.offer.id !== payment.offerId ||
    !isBillingOffer(payment.offer) ||
    payment.offer.amount.value !== payment.amount.value ||
    payment.offer.amount.currency !== payment.amount.currency
  )
    throw new Error(C.verificationError);
  return payment;
}

export const formatBillingAmount = (amount: BillingAmount) =>
  new Intl.NumberFormat(BILLING.locale, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: BILLING.amountFractionDigits,
  }).format(Number(amount.value));
export const formatBillingDate = (date: string) =>
  new Intl.DateTimeFormat(BILLING.locale, {
    timeZone: BILLING.timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(date));
export const formatBillingLastDay = (exclusiveEnd: string) =>
  new Intl.DateTimeFormat(BILLING.locale, {
    timeZone: BILLING.timeZone,
    dateStyle: 'long',
  }).format(new Date(Date.parse(exclusiveEnd) - BILLING.exclusiveEndOffsetMs));
export const billingOfferTerm = (offer: BillingOffer) =>
  offer.durationDays
    ? C.duration(offer.durationDays)
    : offer.expiresAt
      ? offer.period === 'season'
        ? C.expiresInclusive(formatBillingLastDay(offer.expiresAt))
        : C.expires(formatBillingDate(offer.expiresAt))
      : C.conditions;

export function safeBillingReturn(value: string | null): string | null {
  if (value === ROUTES.billingSandbox) return value;
  if (!value?.startsWith(`${ROUTES.billingReturn}?`)) return null;
  const params = new URLSearchParams(value.slice(value.indexOf('?') + 1));
  const id = params.get(BILLING.paymentQuery);
  return id && isPaymentId(id) ? billingReturnPath(id) : null;
}
