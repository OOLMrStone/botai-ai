export const BILLING_PERIODS = {
  monthDays: 30,
  seasonEquivalentMonths: 8,
  dayMs: 86_400_000,
  timeZone: 'Europe/Moscow',
  calendarLocale: 'sv-SE',
  dailyFractionDigits: 2,
  seasonEnd: '2027-06-10',
  seasonEndLabel: '10 июня 2027 года',
} as const;

// Единая сетка цен и объёмов для витрины, paywall и оферты.
export const STOREFRONT_PLANS = [
  {
    id: 'light',
    name: 'Базовый минимум',
    quota: 30,
    seasonQuota: 240,
    month: 299,
    season: 1499,
    recommended: false,
  },
  {
    id: 'core',
    name: 'Золотая середина',
    quota: 70,
    seasonQuota: 560,
    month: 699,
    season: 3499,
    recommended: true,
  },
  {
    id: 'heavy',
    name: 'Роскошный максимум',
    quota: 110,
    seasonQuota: 880,
    month: 899,
    season: 4999,
    recommended: false,
  },
] as const;

export const STOREFRONT_PERIODS = [
  { id: 'month', label: 'Месяц' },
  { id: 'season', label: 'Сезон' },
] as const;
export type StorefrontPeriod = (typeof STOREFRONT_PERIODS)[number]['id'];
export const STOREFRONT_PRICE_FORMAT = {
  locale: 'ru-RU',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
} as const;

// Условия будущего пробного доступа; серверный лимит ещё не подключён.
export const TRIAL_OFFER = { days: 3, checks: 4, available: false } as const;

export const BILLING_COPY = {
  periodLabel: 'Период оплаты',
  checksIncluded: (count: number) => `${count} проверок решений`,
  checkoutUnavailable: 'Оплата пока недоступна. Мы ещё подключаем её - тариф не изменён',
  monthUnit: `за ${BILLING_PERIODS.monthDays} дней`,
  seasonUnit: 'за пакет',
  monthlyEquivalentUnit: 'в месяц',
  monthPayment: `Оплата каждые ${BILLING_PERIODS.monthDays} дней.`,
  seasonPayment: (price: string) => `${price} за пакет, оплачивается целиком`,
  seasonEquivalentNote: `Месячный эквивалент рассчитан за ${BILLING_PERIODS.seasonEquivalentMonths} месяцев сезона.`,
  seasonDeadline: `До ${BILLING_PERIODS.seasonEndLabel} включительно`,
  monthNote: `Автопродление каждые ${BILLING_PERIODS.monthDays} дней. Неиспользованные проверки не переносятся.`,
  seasonNote: `Весь пакет доступен сразу, до ${BILLING_PERIODS.seasonEndLabel} включительно. Без автопродления.`,
  quota: {
    month: `проверок развёрнутых заданий за ${BILLING_PERIODS.monthDays} дней`,
    season: 'проверок развёрнутых заданий за пакет',
  },
} as const;
