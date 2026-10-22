'use client';
import { PLANS, type FeatureId, type Plan } from '@/config/plans';
import { useAsyncData } from '@/hooks/use-async-data';
import { profileResource } from '@/lib/profile-resource';
import { normalizePlan } from '@/lib/plan';
export function usePlan(): Plan {
  const { data } = useAsyncData(profileResource);
  return PLANS[normalizePlan(data?.plan)];
}
export function useHasFeature(feature: FeatureId): boolean {
  const { data } = useAsyncData(profileResource);
  return Boolean(data?.features.includes(feature));
}
