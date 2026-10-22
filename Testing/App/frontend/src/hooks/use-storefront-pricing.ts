'use client';

import { useState } from 'react';

import {
  BILLING_PERIODS,
  BILLING_COPY,
  STOREFRONT_PERIODS,
  STOREFRONT_PLANS,
  STOREFRONT_PRICE_FORMAT,
  type StorefrontPeriod,
} from '@/config/storefront-pricing';

const money = new Intl.NumberFormat(STOREFRONT_PRICE_FORMAT.locale, {
  style: 'currency',
  currency: STOREFRONT_PRICE_FORMAT.currency,
  minimumFractionDigits: STOREFRONT_PRICE_FORMAT.minimumFractionDigits,
  maximumFractionDigits: STOREFRONT_PRICE_FORMAT.maximumFractionDigits,
});

export function useStorefrontPricing() {
  const [period, setPeriod] = useState<StorefrontPeriod>(STOREFRONT_PERIODS[0].id);
  const plans = STOREFRONT_PLANS.map((plan) => ({
    ...plan,
    price:
      period === 'season'
        ? money.format(plan.season / BILLING_PERIODS.seasonEquivalentMonths)
        : money.format(plan.month),
    payment:
      period === 'season'
        ? BILLING_COPY.seasonPayment(money.format(plan.season))
        : BILLING_COPY.monthPayment,
    quota: period === 'season' ? plan.seasonQuota : plan.quota,
  }));
  return { period, setPeriod, plans };
}
