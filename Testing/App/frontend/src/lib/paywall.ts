import { BILLING_PERIODS } from '@/config/storefront-pricing';
import { PAYWALL, type PaywallPeriod, type PaywallPlan } from '@/config/paywall';

export function paywallPrice(plan: PaywallPlan, period: PaywallPeriod) {
  return {
    total: new Intl.NumberFormat(PAYWALL.locale).format(plan[period]),
    checks: period === 'season' ? plan.seasonQuota : plan.quota,
  };
}

// Сезон заканчивается в фиксированную дату, поэтому сравнение зависит от дня покупки.
export function paywallDailyPrice(plan: PaywallPlan, now = new Date()) {
  const today = new Intl.DateTimeFormat(BILLING_PERIODS.calendarLocale, {
    timeZone: BILLING_PERIODS.timeZone,
  }).format(now);
  const days =
    Math.round(
      (Date.parse(BILLING_PERIODS.seasonEnd) - Date.parse(today)) / BILLING_PERIODS.dayMs,
    ) + 1;
  if (days <= 0) return null;

  return {
    days,
    amount: new Intl.NumberFormat(PAYWALL.locale, {
      minimumFractionDigits: BILLING_PERIODS.dailyFractionDigits,
      maximumFractionDigits: BILLING_PERIODS.dailyFractionDigits,
    }).format(plan.season / days),
  };
}
