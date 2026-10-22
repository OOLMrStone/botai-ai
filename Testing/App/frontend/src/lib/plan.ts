import { DEFAULT_PLAN, PLANS, type FeatureId, type PlanId } from '@/config/plans';

// Открыта ли фича на этом тарифе. Единственный способ гейтить платное -
// экраны не сравнивают id тарифов между собой.
export function hasFeature(plan: PlanId, feature: FeatureId): boolean {
  return PLANS[plan].features.includes(feature);
}

// Тариф с бэкенда: незнакомое или пустое значение считаем бесплатным.
export function normalizePlan(plan: string | undefined): PlanId {
  return plan && plan in PLANS ? (plan as PlanId) : DEFAULT_PLAN;
}
