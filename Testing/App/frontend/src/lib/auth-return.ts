import { BILLING } from '@/config/billing';
import { safeBillingReturn } from '@/lib/billing';

export function rememberAuthReturn(path: string) {
  const destination = safeBillingReturn(path);
  if (!destination) return;
  try {
    sessionStorage.setItem(BILLING.returnStorageKey, destination);
  } catch {
    /* Вход остаётся доступным без sessionStorage. */
  }
}

export function takeAuthReturn(): string | null {
  try {
    const destination = safeBillingReturn(sessionStorage.getItem(BILLING.returnStorageKey));
    sessionStorage.removeItem(BILLING.returnStorageKey);
    return destination;
  } catch {
    return null;
  }
}
