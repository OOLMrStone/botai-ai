'use client';

import { QUIZ_TOPICS } from '@/config/quiz-content';
import { QUIZ_ENGINE, type QuizAnswerTone, type QuizPairSide } from '@/config/quiz-engine';
import { isQuizAnswerReady, quizOptionsByIds, quizRightPairs } from '@/lib/quiz';
import { useQuizStore } from '@/stores/quiz-store';

export function useQuiz() {
  const state = useQuizStore();
  const topic = QUIZ_TOPICS.find((candidate) => candidate.id === state.topicId);
  const question = state.questions[state.index];
  const selectedOptions = quizOptionsByIds(question, state.selectedIds);
  const correctAnswer = quizOptionsByIds(
    question,
    question && question.kind !== 'pairs' ? question.answerIds : [],
  )
    .map((option) => option.latex)
    .join(QUIZ_ENGINE.formulaSeparator);
  const selectedTone: QuizAnswerTone =
    state.feedback === 'correct'
      ? 'matched'
      : state.feedback === 'incorrect'
        ? 'incorrect'
        : 'selected';
  const optionTone = (id: string): QuizAnswerTone => {
    if (state.feedback && question?.kind === 'choice' && question.answerIds.includes(id))
      return 'matched';
    if (state.selectedIds.includes(id)) return selectedTone;

    return 'idle';
  };
  const pairTone = (side: QuizPairSide, id: string): QuizAnswerTone => {
    if (state.matchedIds.includes(id)) return 'matched';
    const selectedId = side === 'left' ? state.selectedLeftId : state.selectedRightId;
    const errorId = side === 'left' ? state.pairError?.leftId : state.pairError?.rightId;
    if (errorId === id) return 'incorrect';
    if (selectedId === id) return 'selected';

    return 'idle';
  };
  const completed = state.index + Number(Boolean(state.feedback));

  return {
    ...state,
    topic,
    selectedOptions,
    selectedTone,
    optionTone,
    pairTone,
    correctAnswer,
    question,
    ready: isQuizAnswerReady(question, state.selectedIds, state.matchedIds),
    progress: state.questions.length ? completed / state.questions.length : 0,
    finished: Boolean(state.feedback) && completed === state.questions.length,
    rightPairs: quizRightPairs(question),
  };
}
