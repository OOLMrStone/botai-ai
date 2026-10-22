import { layout } from '@/config/layout';
import type { QuizAnswerTone } from '@/config/quiz-engine';

export function quizFeedbackMotion(tone: QuizAnswerTone, enabled = true) {
  if (!enabled) return undefined;
  if (tone === 'matched') return layout.quiz.answerSuccessMotion;
  if (tone === 'incorrect') return layout.quiz.answerErrorMotion;

  return undefined;
}
