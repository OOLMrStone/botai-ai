'use client';

import { create } from 'zustand';

import { QUIZ_TOPICS, type QuizDifficulty } from '@/config/quiz-content';
import {
  QUIZ_ENGINE,
  QUIZ_EMPTY_ANSWER,
  QUIZ_EMPTY_SESSION,
  type QuizLength,
  type QuizPairSide,
  type QuizPairError,
  type QuizSessionState,
} from '@/config/quiz-engine';
import {
  isQuizAnswerCorrect,
  isQuizAnswerReady,
  selectQuizQuestions,
  toggleQuizAnswer,
} from '@/lib/quiz';

interface QuizState extends QuizSessionState {
  stage: 'catalog' | 'setup' | 'playing' | 'result';
  topicId: string | null;
  difficulty: QuizDifficulty;
  length: QuizLength;
  selectTopic: (topicId: string) => void;
  setDifficulty: (difficulty: QuizDifficulty) => void;
  setLength: (length: QuizLength) => void;
  start: () => void;
  choose: (id: string) => void;
  selectPair: (side: QuizPairSide, id: string) => void;
  clearPairError: (error: QuizPairError) => void;
  check: () => void;
  next: () => void;
  exit: () => void;
}

export const useQuizStore = create<QuizState>((set) => ({
  ...QUIZ_EMPTY_SESSION,
  stage: 'catalog',
  topicId: null,
  difficulty: QUIZ_ENGINE.defaultDifficulty,
  length: QUIZ_ENGINE.defaultLength,
  selectTopic: (topicId) =>
    set((state) =>
      QUIZ_TOPICS.some((topic) => topic.id === topicId)
        ? { ...QUIZ_EMPTY_SESSION, topicId, stage: 'setup' }
        : state,
    ),
  setDifficulty: (difficulty) => set((state) => (state.stage === 'setup' ? { difficulty } : state)),
  setLength: (length) => set((state) => (state.stage === 'setup' ? { length } : state)),
  start: () =>
    set((state) => {
      if (!state.topicId || (state.stage !== 'setup' && state.stage !== 'result')) return state;
      const questions = selectQuizQuestions(state.topicId, state.difficulty, state.length);
      if (questions.length !== state.length) return state;

      return { ...QUIZ_EMPTY_SESSION, questions, stage: 'playing' };
    }),
  choose: (id) =>
    set((state) => {
      const question = state.questions[state.index];
      if (state.stage !== 'playing' || state.feedback || !question) return state;

      return { selectedIds: toggleQuizAnswer(question, state.selectedIds, id) };
    }),
  selectPair: (side, id) =>
    set((state) => {
      const question = state.questions[state.index];
      if (
        state.stage !== 'playing' ||
        state.feedback ||
        question?.kind !== 'pairs' ||
        state.matchedIds.includes(id) ||
        !question.pairs.some((pair) => pair.id === id)
      )
        return state;

      const selectedLeftId = side === 'left' ? id : state.selectedLeftId;
      const selectedRightId = side === 'right' ? id : state.selectedRightId;
      if (!selectedLeftId || !selectedRightId)
        return { selectedLeftId, selectedRightId, pairError: null };

      const clearedSelection = { selectedLeftId: null, selectedRightId: null };
      if (selectedLeftId !== selectedRightId)
        return {
          ...clearedSelection,
          pairError: { leftId: selectedLeftId, rightId: selectedRightId },
          pairMistakes: state.pairMistakes + 1,
        };

      return {
        ...clearedSelection,
        matchedIds: [...state.matchedIds, id],
        pairError: null,
      };
    }),
  clearPairError: (error) =>
    set((state) => (state.pairError === error ? { pairError: null } : state)),
  check: () =>
    set((state) => {
      const question = state.questions[state.index];
      if (
        state.stage !== 'playing' ||
        state.feedback ||
        !question ||
        !isQuizAnswerReady(question, state.selectedIds, state.matchedIds)
      )
        return state;
      const correct = isQuizAnswerCorrect(question, state.selectedIds, state.pairMistakes);

      return {
        feedback: correct ? 'correct' : 'incorrect',
        score: state.score + Number(correct),
      };
    }),
  next: () =>
    set((state) => {
      if (state.stage !== 'playing' || !state.feedback) return state;
      if (state.index === state.questions.length - 1) return { stage: 'result' };

      return { ...QUIZ_EMPTY_ANSWER, index: state.index + 1 };
    }),
  exit: () => set({ ...QUIZ_EMPTY_SESSION, stage: 'catalog', topicId: null }),
}));
