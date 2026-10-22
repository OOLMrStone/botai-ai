import { EXPERIMENTAL } from '@/config/experimental';

export function normalizeExperimentalScore(score: number): number {
  if (!Number.isFinite(score)) return EXPERIMENTAL.score;

  return Math.min(EXPERIMENTAL.maxScore, Math.max(EXPERIMENTAL.minScore, Math.round(score)));
}
