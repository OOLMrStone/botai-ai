import type { Difficulty } from '@/config/tasks';
import {
  TASK_DIFFICULTY_ANCHORS,
  TASK_DIFFICULTY_OPTIONS,
  TASK_DIFFICULTY_SLIDER,
} from '@/config/tasks';

export type DifficultyMix = Record<Difficulty, number>;

export function clampDifficultyLevel(level: number) {
  if (!Number.isFinite(level)) return TASK_DIFFICULTY_SLIDER.defaultValue;
  return Math.min(TASK_DIFFICULTY_SLIDER.max, Math.max(TASK_DIFFICULTY_SLIDER.min, level));
}

export function difficultyMixAt(rawLevel: number): DifficultyMix {
  const level = clampDifficultyLevel(rawLevel);
  const upperIndex = TASK_DIFFICULTY_ANCHORS.findIndex((anchor) => anchor.level >= level);
  const to = TASK_DIFFICULTY_ANCHORS[Math.max(1, upperIndex)];
  const from = TASK_DIFFICULTY_ANCHORS[Math.max(1, upperIndex) - 1];
  const position = (level - from.level) / (to.level - from.level);
  const progress = position * position * (3 - 2 * position);

  return Object.fromEntries(
    TASK_DIFFICULTY_OPTIONS.map((difficulty) => [
      difficulty,
      from.weights[difficulty] + (to.weights[difficulty] - from.weights[difficulty]) * progress,
    ]),
  ) as DifficultyMix;
}

export function difficultiesAt(level: number) {
  const mix = difficultyMixAt(level);
  return TASK_DIFFICULTY_OPTIONS.filter((difficulty) => mix[difficulty] > 0);
}

export function allowsUnratedDifficulty(level: number) {
  const normalized = clampDifficultyLevel(level);
  return normalized > TASK_DIFFICULTY_SLIDER.min && normalized < TASK_DIFFICULTY_SLIDER.max;
}

export function isDifficultyEligible(difficulty: Difficulty | null, level: number) {
  const normalized = clampDifficultyLevel(level);
  if (allowsUnratedDifficulty(normalized)) return true;
  if (difficulty === null) return false;
  const endpoint =
    normalized === TASK_DIFFICULTY_SLIDER.min
      ? TASK_DIFFICULTY_ANCHORS[0]
      : TASK_DIFFICULTY_ANCHORS[TASK_DIFFICULTY_ANCHORS.length - 1];
  return endpoint.weights[difficulty] > 0;
}

export function difficultyLevelFromSelection(difficulties: Difficulty[]) {
  if (difficulties.length === 1 && difficulties[0] === 1) return TASK_DIFFICULTY_SLIDER.min;
  if (difficulties.length > 0 && difficulties.every((difficulty) => difficulty >= 4))
    return TASK_DIFFICULTY_SLIDER.max;
  return TASK_DIFFICULTY_SLIDER.defaultValue;
}

export function difficultyLabelKey(level: number) {
  const normalized = clampDifficultyLevel(level);
  if (normalized === TASK_DIFFICULTY_SLIDER.min) return 'easy' as const;
  if (normalized < TASK_DIFFICULTY_SLIDER.defaultValue) return 'easyMedium' as const;
  if (normalized === TASK_DIFFICULTY_SLIDER.defaultValue) return 'balanced' as const;
  if (normalized < TASK_DIFFICULTY_SLIDER.max) return 'mediumHard' as const;
  return 'hard' as const;
}

export function allocateDifficultyCounts(total: number, level: number) {
  const mix = difficultyMixAt(level);
  const raw = TASK_DIFFICULTY_OPTIONS.map((difficulty) => ({
    difficulty,
    value: mix[difficulty] * total,
  }));
  const counts = Object.fromEntries(
    raw.map(({ difficulty, value }) => [difficulty, Math.floor(value)]),
  ) as DifficultyMix;

  let remainder = total - Object.values(counts).reduce((sum, count) => sum + count, 0);
  raw
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)))
    .forEach(({ difficulty }) => {
      if (remainder <= 0) return;
      counts[difficulty] += 1;
      remainder -= 1;
    });

  return counts;
}
