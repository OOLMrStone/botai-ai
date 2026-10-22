import type { CSSProperties } from 'react';

import { STOREFRONT_GRAPH_VIDEO } from '@/config/storefront-graph';

import { BILLING_COPY, TRIAL_OFFER } from '@/config/storefront-pricing';
import { BRAND } from '@/config/brand';
import { LEGAL_OPERATOR } from '@/config/legal-operator';
import { LEGAL_COPY } from '@/config/legal';
import { onboardingPath, ROUTES } from '@/config/onboarding-steps';

const email = LEGAL_OPERATOR.email;

export const STOREFRONT = {
  metadata: {
    title: `${BRAND.name} - проверка решений ЕГЭ по математике`,
    description:
      'Проверка решений ЕГЭ по профильной математике: фотография работы, разбор ошибок и рекомендации',
  },
  home: ROUTES.storefront,
  start: onboardingPath('welcome'),
  login: ROUTES.login,
  account: ROUTES.home,
  email,
  mailto: `mailto:${email}`,
  contacts: [
    { label: '+7 985 202-64-97', href: 'tel:+79852026497' },
    { label: '@oolmrstone', href: 'https://t.me/oolmrstone' },
    { label: email, href: `mailto:${email}` },
  ],
  logo: { src: '/icons/site-192.png', width: 192, height: 192 },
  mascot: {
    src: '/storefront/lemur.webp',
    width: 960,
    height: 775,
    sizes: '(min-width: 1024px) 440px, 80vw',
  },
  features: { workflow: true, trial: TRIAL_OFFER.available },
  sections: {
    workflow: 'how-it-works',
    pricing: 'pricing',
    questions: 'questions',
    contacts: 'contacts',
  },
  mobileMenu: 'storefront-menu',
  main: 'storefront-content',
} as const;

export const STOREFRONT_NAV = [
  {
    label: 'Как это работает',
    href: `#${STOREFRONT.sections.workflow}`,
    enabled: STOREFRONT.features.workflow,
  },
  { label: 'Тарифы', href: `#${STOREFRONT.sections.pricing}` },
  { label: 'Вопросы', href: `#${STOREFRONT.sections.questions}` },
  { label: LEGAL_COPY.title, href: ROUTES.legal },
];

export const STOREFRONT_COPY = {
  nav: 'Навигация по сайту',
  openMenu: 'Открыть меню',
  closeMenu: 'Закрыть меню',
  skip: 'К содержанию',
  home: `${BRAND.name} - на главную`,
  check: 'Проверить решение',
  login: 'Войти',
  continue: 'Продолжить подготовку',
  account: 'Мой кабинет',
  sessionError: 'Не удалось проверить вход. Можно повторить проверку или войти заново',
  trial: `${TRIAL_OFFER.days} дня бесплатно`,
  trialDetails: 'Без карты и автопродления',
  hero: {
    title: 'Проверка решений\nпо математике',
    description:
      'Сфотографируй решение. Получи разбор по критериям ЕГЭ: где допущена ошибка, за что теряются баллы и как это исправить',
  },
  workflow: {
    eyebrow: 'Как это работает',
    title: 'От снимка к результату',
    description: 'Решай сам, а Бо поможет разобраться в ошибках',
    swipeHint: 'Листай, чтобы увидеть все три шага →',
    steps: [
      {
        id: 'camera',
        number: '01',
        title: 'Сфотографируй',
        description: 'Реши задание на бумаге и загрузи фото. Бо прочитает твой почерк',
      },
      {
        id: 'scan',
        number: '02',
        title: 'Дождись проверки',
        description: 'Бо прочитает решение и проверит каждый шаг по критериям ЕГЭ',
      },
      {
        id: 'result',
        number: '03',
        title: 'Разберись в ошибке',
        description: 'Узнай, за что потерял баллы и как исправить решение',
      },
    ],
  },
  graph: {
    title: 'У математики есть сердце',
    instruction: 'Построй график уравнения',
    equation: '(x^2 + y^2 - 1)^3 - x^2y^3 = 0',
    build: 'Построить',
    reset: 'Ещё раз',
    label: 'График уравнения в форме сердца',
    dots: ['red', 'yellow', 'green'],
  },
  pricing: {
    eyebrow: 'Тарифы',
    title: 'Выбери свой темп',
    description: 'Выбери количество проверок под свой темп подготовки',
    free: 'Практика и готовые решения - бесплатно',
    trial: `${TRIAL_OFFER.checks} бесплатные проверки за ${TRIAL_OFFER.days} дня`,
    trialStatus: 'Скоро',
    action: 'Купить',
    ...BILLING_COPY,
    recommendation: 'Рекомендуемый',
    details: 'Разбор решения по критериям ЕГЭ с объяснением ошибок',
  },
  about: {
    eyebrow: 'Вопросы и ответы',
    title: 'Что важно знать',
    questions: [
      {
        question: 'Как отправить решение на проверку?',
        answer: 'Сфотографируй свою работу и загрузи снимок. Перепечатывать решение не нужно',
      },
      {
        question: 'Как лучше сфотографировать тетрадь?',
        answer:
          'Снимай при хорошем свете, держи камеру прямо над листом. В кадр должны попасть условие и все шаги решения, а текст и формулы должны быть чёткими',
      },
      {
        question: 'Что я получу после проверки?',
        answer:
          'Разбор по критериям ЕГЭ: замечания к шагам решения, объяснение ошибок и рекомендации, что исправить',
      },
      {
        question: 'Что доступно бесплатно?',
        answer:
          'Практика и готовые решения. Для проверки развёрнутых заданий выбери подходящий тариф',
      },
      {
        question: 'Какой тариф выбрать?',
        answer:
          'Ориентируйся на количество работ, которые хочешь проверять каждый месяц. Во всех тарифах один формат разбора, отличается лимит проверок',
      },
      {
        question: 'Остались вопросы?',
        answer: 'Напиши нам в Telegram или на почту. Контакты находятся внизу страницы',
      },
    ],
  },
  footer: {
    description: 'ЕГЭ по профильной математике',
    contactTitle: 'Контакты',
    legal: LEGAL_OPERATOR.name,
    taxId: `ИНН ${LEGAL_OPERATOR.taxId}`,
  },
} as const;

export const STOREFRONT_THEME = {
  '--sf-paper': 'var(--palette-paper)',
  '--sf-warm': 'var(--palette-surface)',
  '--sf-ink': 'var(--palette-ink)',
  '--sf-muted': 'var(--palette-muted)',
  '--sf-line': 'color-mix(in srgb, var(--sf-ink) 15%, var(--sf-paper))',
  '--sf-control': 'color-mix(in srgb, var(--sf-ink) 8%, var(--sf-paper))',
  '--sf-inverse-muted': 'color-mix(in srgb, var(--sf-paper) 78%, var(--sf-ink))',
  '--sf-inverse-control': 'color-mix(in srgb, var(--sf-paper) 12%, var(--sf-ink))',
  '--sf-orange': 'var(--palette-yellow)',
  '--sf-pale': 'var(--palette-pale)',
  colorScheme: 'light',
} as CSSProperties;

export const STOREFRONT_GRAPH_ANIMATION = {
  title: STOREFRONT_COPY.graph.title,
  subtitle: '',
  label: STOREFRONT_COPY.graph.label,
  video: STOREFRONT_GRAPH_VIDEO.video,
  poster: STOREFRONT_GRAPH_VIDEO.poster,
  loop: false,
} as const;
