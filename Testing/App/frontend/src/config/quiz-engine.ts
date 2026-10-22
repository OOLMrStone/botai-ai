import type { QUIZ_LENGTHS } from '@/config/quiz';
import type { QuizQuestion } from '@/config/quiz-content';

export const QUIZ_ENGINE = {
  defaultDifficulty: 'basic',
  defaultLength: 3,
  pairErrorMs: 550,
  mechanics: ['choice', 'pairs', 'build'],
  formulaSeparator: ' ',
  shuffle: {
    hashOffset: 2166136261,
    hashPrime: 16777619,
    multiplier: 1664525,
    increment: 1013904223,
    range: 4294967296,
  },
} as const;

export type QuizLength = (typeof QUIZ_LENGTHS)[number]['id'];

export type QuizPairSide = 'left' | 'right';

export interface QuizPairError {
  leftId: string;
  rightId: string;
}

export interface QuizSessionState {
  questions: QuizQuestion[];
  index: number;
  selectedIds: string[];
  matchedIds: string[];
  selectedLeftId: string | null;
  selectedRightId: string | null;
  feedback: 'correct' | 'incorrect' | null;
  pairError: QuizPairError | null;
  pairMistakes: number;
  score: number;
}

export const QUIZ_EMPTY_ANSWER: Pick<
  QuizSessionState,
  | 'selectedIds'
  | 'matchedIds'
  | 'selectedLeftId'
  | 'selectedRightId'
  | 'feedback'
  | 'pairError'
  | 'pairMistakes'
> = {
  selectedIds: [],
  matchedIds: [],
  selectedLeftId: null,
  selectedRightId: null,
  feedback: null,
  pairError: null,
  pairMistakes: 0,
};

export const QUIZ_EMPTY_SESSION: QuizSessionState = {
  ...QUIZ_EMPTY_ANSWER,
  questions: [],
  index: 0,
  score: 0,
};

export type QuizAnswerTone = 'matched' | 'incorrect' | 'selected' | 'idle';
