import { TRAINING_REVIEW_STATES } from '@/config/training-review';

export const ATTEMPT_FEEDBACK_COPY = {
  correct: TRAINING_REVIEW_STATES.correct.label,
  incorrect: 'Пока неверно',
  photoScore: (score: number, maxScore: number) => `${score} из ${maxScore} баллов`,
  photoReady: 'Решение готово к проверке',
  photoSaved: 'Решение сохранено',
  retryPhoto: 'Прикрепить решение заново',
  where: (text: string) => `Где: ${text}`,
  correction: (text: string) => `Как исправить: ${text}`,
} as const;

export const CANCELLABLE_SUBMISSION_STATES = ['queued', 'running'] as const;
