// Тарифы и то, что они открывают - один источник правды. Гейт фичи в UI
// спрашивает только hasFeature (lib/plan), а не сравнивает id тарифа руками.

export type PlanId = 'free' | 'pro';

// Возможности, которые тариф может открыть. Новая платная фича = новый id здесь
// + строка в features нужного тарифа; экраны не переписываются.
export type FeatureId = 'aiReview';

export interface Plan {
  id: PlanId;
  label: string;
  description: string;
  features: readonly FeatureId[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Бесплатный',
    description: 'Уроки и задачи по программе',
    features: [],
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    description: 'Всё бесплатное плюс разбор задач с ИИ',
    features: ['aiReview'],
  },
};

// Порядок тарифов - для переключателей и будущего экрана тарифов.
export const PLAN_IDS: PlanId[] = ['free', 'pro'];

// Тариф пользователя, о котором бэкенд ещё не рассказал.
export const DEFAULT_PLAN: PlanId = 'free';
