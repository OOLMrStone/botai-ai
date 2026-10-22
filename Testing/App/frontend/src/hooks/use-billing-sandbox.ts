'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BILLING, BILLING_COPY as C } from '@/config/billing';
import {
  createTestPayment,
  createTestSubscription,
  fetchBillingOffers,
  fetchBillingStatus,
  type BillingOffers,
  type BillingStatus,
  type BillingSubscription,
  type BillingConsent,
} from '@/lib/api/billing';
import { ApiError } from '@/lib/api/client';
import {
  billingReturnPath,
  confirmationUrl,
  isBillingOffer,
  isPaymentId,
  isSubscriptionOffer,
} from '@/lib/billing';
import {
  readBillingIntent,
  rejectBillingConsent,
  submitBillingIntent,
  type BillingIntent,
} from '@/lib/billing-intent';
import { useAuthStore } from '@/stores/auth-store';

export function useBillingSandbox() {
  const router = useRouter();
  const owner = useAuthStore((state) => state.user?.id ?? '');
  const [catalog, setCatalog] = useState<BillingOffers | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [intent, setIntent] = useState<BillingIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!owner) return;
      try {
        const [offers, access] = await Promise.all([
          fetchBillingOffers(controller.signal),
          fetchBillingStatus(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        let previous: BillingIntent | null = null;
        let storageError = false;
        try {
          previous = readBillingIntent(sessionStorage, owner);
        } catch {
          storageError = true;
        }
        setCatalog(offers);
        setStatus(access);
        setLoadedOwner(owner);
        setIntent(previous);
        setConsentAccepted(false);
        const preferred = offers.offers.find(
          (offer) => offer.plan === BILLING.initialPlan && offer.period === BILLING.initialPeriod,
        );
        setSelected(previous?.offerId ?? preferred?.id ?? offers.offers[0]?.id ?? null);
        setError(storageError ? C.storageError : null);
      } catch {
        if (!controller.signal.aborted) setError(C.loadError);
      }
    }
    void load();
    return () => controller.abort();
  }, [owner, revision]);

  const enabled =
    owner === loadedOwner &&
    catalog?.mode === 'test' &&
    catalog.testOnly === true &&
    status?.mode === 'test' &&
    status.testOnly === true;
  const offers = enabled ? catalog.offers.filter(isBillingOffer) : [];
  const selectedOffer = intent?.offer ?? offers.find((offer) => offer.id === selected) ?? null;
  const period = selectedOffer?.period ?? BILLING.initialPeriod;
  const periodOffers = offers.filter((offer) => offer.period === period);
  const currentPaymentId =
    status?.currentPaymentId && isPaymentId(status.currentPaymentId)
      ? status.currentPaymentId
      : null;
  const resumePaymentId = currentPaymentId ?? intent?.paymentId;
  const recovering = Boolean(intent || currentPaymentId);
  const available = Boolean(
    enabled && (resumePaymentId || (selected && (status.canPurchase || intent))),
  );
  const consentNeeded = Boolean(selectedOffer && isSubscriptionOffer(selectedOffer) && !recovering);
  const canSubmit = available && (!consentNeeded || consentAccepted);

  function select(offerId: string) {
    if (pending || recovering || !status?.canPurchase || offerId === selected) return;
    setSelected(offerId);
    setConsentAccepted(false);
  }

  function changePeriod(next: 'month' | 'season') {
    if (pending || recovering) return;
    const nextOffer =
      offers.find((offer) => offer.period === next && offer.plan === selectedOffer?.plan) ??
      offers.find((offer) => offer.period === next);
    if (nextOffer) select(nextOffer.id);
  }

  const submit = useCallback(async () => {
    if (busy.current || !canSubmit || useAuthStore.getState().user?.id !== owner) return;
    if (resumePaymentId) {
      router.push(billingReturnPath(resumePaymentId));
      return;
    }
    if (!selected || (!selectedOffer && !intent)) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const consent: BillingConsent | undefined =
        selectedOffer && isSubscriptionOffer(selectedOffer) && consentAccepted
          ? { accepted: true, version: selectedOffer.consentVersion }
          : undefined;
      const payment = await submitBillingIntent(
        sessionStorage,
        owner,
        selected,
        async (offerId, key, accepted) =>
          accepted
            ? (await createTestSubscription(offerId, key, accepted)).payment
            : createTestPayment(offerId, key),
        selectedOffer ? { offer: selectedOffer, consent } : undefined,
      );
      if (!active.current || useAuthStore.getState().user?.id !== owner) return;
      const next = billingReturnPath(payment.id);
      const url = payment.status === 'pending' ? confirmationUrl(payment.confirmationUrl) : null;
      if (url) window.location.assign(url);
      else router.push(next);
    } catch (cause) {
      if (!active.current || useAuthStore.getState().user?.id !== owner) return;
      let storageFailed = false;
      try {
        if (
          cause instanceof ApiError &&
          ['recurring_consent_required', 'recurring_consent_changed'].includes(cause.code ?? '')
        ) {
          rejectBillingConsent(sessionStorage, owner);
          setConsentAccepted(false);
        }
        setIntent(readBillingIntent(sessionStorage, owner));
      } catch {
        storageFailed = true;
      }
      if (
        cause instanceof ApiError &&
        ['recurring_consent_required', 'recurring_consent_changed'].includes(cause.code ?? '')
      ) {
        setError(C.consentChanged);
      } else if (
        cause instanceof ApiError &&
        ['billing_unavailable', 'billing_purchase_unavailable'].includes(cause.code ?? '')
      ) {
        setError(C.blocked);
      } else if (
        storageFailed ||
        (cause instanceof DOMException &&
          ['SecurityError', 'QuotaExceededError'].includes(cause.name))
      ) {
        setError(C.storageError);
      } else {
        setError(C.createError);
      }
      busy.current = false;
      setPending(false);
    }
  }, [canSubmit, consentAccepted, intent, owner, resumePaymentId, router, selected, selectedOffer]);

  return {
    catalog,
    status,
    offers,
    periodOffers,
    selectedOffer,
    period,
    changePeriod,
    expanded,
    selectedRef,
    expand: () => {
      selectedRef.current?.focus({ preventScroll: true });
      setExpanded(true);
    },
    enabled,
    selected,
    select,
    consentAccepted,
    consentNeeded,
    consentRef,
    focusConsent: () => {
      if (busy.current || !consentNeeded || consentAccepted) return;
      consentRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      consentRef.current?.focus({ preventScroll: true });
    },
    acceptConsent: setConsentAccepted,
    canSubmit,
    updateSubscription: (subscription: BillingSubscription) =>
      setStatus((previous) =>
        previous?.subscription?.id === subscription.id ? { ...previous, subscription } : previous,
      ),
    intent,
    recovering,
    resumePaymentId,
    pending,
    error,
    available,
    submit,
    retry: () => setRevision((value) => value + 1),
  };
}
