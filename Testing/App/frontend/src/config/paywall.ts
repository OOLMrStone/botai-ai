import {
  BILLING_COPY,
  STOREFRONT_PLANS,
  STOREFRONT_PRICE_FORMAT,
} from '@/config/storefront-pricing';

export const PAYWALL_PLANS = STOREFRONT_PLANS;
export type PaywallPlan = (typeof PAYWALL_PLANS)[number];
export type PaywallPeriod = 'month' | 'season';
export type PaywallEntry = 'photo' | 'profile';
export const PAYWALL = {
  initialPlan: 'core',
  initialPeriod: 'season',
  locale: STOREFRONT_PRICE_FORMAT.locale,
  plansId: 'paywall-plans',
  planSelector: 'button',
  motion: { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', delay: 90, offset: 12 },
} as const;
export const PAYWALL_COPY = {
  photo: {
    title: 'Продолжай ботать!',
    subtitle: 'На бесплатном тарифе ты больше не сможешь проверять задания 2-й части',
  },
  profile: {
    title: 'Выбери свой тариф',
    subtitle: 'Проверяй задания 2-й части и разбирай ошибки вместе с Бо',
  },
  close: 'Вернуться к подготовке',
  legalSeparator: '·',
  plans: 'Тарифы',
  recommended: 'Рекомендуемый',
  selected: 'Твой тариф',
  other: 'Другие тарифы',
  continue: 'Продолжить',
  pricePeriod: { month: BILLING_COPY.monthUnit, season: BILLING_COPY.seasonUnit },
  currency: '₽',
  quota: (count: number, period: PaywallPeriod) => `${count} ${BILLING_COPY.quota[period]}`,
  packageAvailable: 'Весь пакет доступен сразу',
  perDay: 'в день',
  dailyEquivalent: (days: number) =>
    `Стоимость пакета, разделённая на ${days} дней до конца сезона включительно`,
  checkoutUnavailable: BILLING_COPY.checkoutUnavailable,
  profileAction: 'Посмотреть тарифы',
} as const;
