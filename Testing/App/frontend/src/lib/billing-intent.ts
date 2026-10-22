import { BILLING, BILLING_COPY as C } from '@/config/billing';
import { assertTestPayment, isPaymentId, isSubscriptionOffer } from '@/lib/billing';
import type { BillingConsent, BillingOffer, BillingPayment } from '@/lib/api/billing';
import { createClientId } from '@/lib/client-id';

export interface BillingIntent {
  key: string;
  offerId: string;
  paymentId?: string;
  offer?: BillingOffer;
  consent?: BillingConsent;
}
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (owner: string) => `${BILLING.intentStoragePrefix}${owner}`;

export function readBillingIntent(storage: IntentStorage, owner: string): BillingIntent | null {
  const raw = storage.getItem(storageKey(owner));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('key' in value) || !('offerId' in value))
      return null;
    if (
      typeof value.key !== 'string' ||
      !isPaymentId(value.key) ||
      typeof value.offerId !== 'string'
    )
      return null;
    if (
      'paymentId' in value &&
      (typeof value.paymentId !== 'string' || !isPaymentId(value.paymentId))
    )
      return null;
    return value as BillingIntent;
  } catch {
    return null;
  }
}

export function saveBillingIntent(storage: IntentStorage, owner: string, intent: BillingIntent) {
  storage.setItem(storageKey(owner), JSON.stringify(intent));
}

export async function submitBillingIntent(
  storage: IntentStorage,
  owner: string,
  offerId: string,
  create: (offer: string, key: string, consent?: BillingConsent) => Promise<BillingPayment>,
  terms?: { offer: BillingOffer; consent?: BillingConsent },
) {
  const previous = readBillingIntent(storage, owner);
  if (previous && previous.offerId !== offerId) throw new Error(C.recovery);
  const intent = previous ?? { key: createClientId(), offerId, ...terms };
  if (
    intent.offer?.kind === 'subscription' &&
    (!isSubscriptionOffer(intent.offer) ||
      intent.consent?.accepted !== true ||
      intent.consent.version !== intent.offer.consentVersion)
  )
    throw new Error(C.consentRequired);
  if (intent.consent && intent.offer?.kind !== 'subscription') throw new Error(C.verificationError);
  // Сохраняем ключ до запроса: потеря ответа не должна породить новую операцию.
  saveBillingIntent(storage, owner, intent);
  const payment = assertTestPayment(await create(offerId, intent.key, intent.consent));
  if (payment.offerId !== intent.offerId) throw new Error(C.verificationError);
  saveBillingIntent(storage, owner, { ...intent, paymentId: payment.id });
  return payment;
}

// Эти ошибки возвращаются до создания операции; неизвестный результат так не очищаем.
export function rejectBillingConsent(storage: IntentStorage, owner: string) {
  if (!readBillingIntent(storage, owner)?.paymentId) storage.removeItem(storageKey(owner));
}

export function finishBillingIntent(
  storage: IntentStorage,
  owner: string,
  payment: BillingPayment,
) {
  if (!payment.test || !['succeeded', 'canceled'].includes(payment.status)) return;
  if (readBillingIntent(storage, owner)?.paymentId === payment.id)
    storage.removeItem(storageKey(owner));
}
