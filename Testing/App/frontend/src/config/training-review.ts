import {
  Check,
  Circle,
  Clock,
  ImagePlus,
  Minus,
  Pencil,
  X,
  RotateCcw,
  BookOpen,
  CircleAlert,
  Lock,
} from 'lucide-react';

export const TRAINING_REVIEW_COPY = {
  title: 'Твоя тренировка',
  result: 'Результаты тренировки',
  empty: 'Начни с любой задачи ниже. Ответы сохраняются автоматически',
  ready: 'Можно проверить готовые ответы или вернуться к задачам',
  readyWithProPhotos:
    'Короткие ответы готовы к проверке. Решения сохранены - их проверка доступна в Pro',
  photoSavedPro: 'Решение сохранено. Проверка доступна в Pro',
  photoProNotice: 'Прикрепление и проверка файлов решения доступны на платном тарифе',
  finished: 'Открой задачу, чтобы посмотреть свой ответ и разбор',
  pending: 'Проверяем решения. Результаты появятся здесь',
  attention: 'Открой задачу ниже - подскажем, что сделать дальше',
  continue: 'Посмотри проверенные ответы или продолжи оставшиеся задачи',
  exit: 'Сохранить и выйти',
  done: 'На главную',
  check: 'Проверить ответы',
  position: (current: number, total: number) => `Задание ${current} из ${total}`,
  overview: 'Обзор тренировки',
  task: (number: number) => `№${number}`,
  readyCount: (ready: number, total: number) => `${ready} из ${total} готовы к проверке`,
  checkedCount: (graded: number, total: number) => `${graded} из ${total} проверено`,
} as const;

export const TRAINING_REVIEW_STATES = {
  empty: { label: 'Без ответа', icon: Circle, className: 'text-muted-foreground' },
  photo: { label: 'Прикрепи решение', icon: ImagePlus, className: 'text-muted-foreground' },
  pro: { label: 'Решение сохранено · Проверка в Pro', icon: Lock, className: 'text-muted-foreground' },
  ready: { label: 'Ответ записан', icon: Pencil, className: 'text-foreground' },
  invalid: { label: 'Допиши ответ', icon: Pencil, className: 'text-muted-foreground' },
  failed: { label: 'Не удалось проверить', icon: RotateCcw, className: 'text-destructive' },
  rejected: { label: 'Прикрепи решение заново', icon: ImagePlus, className: 'text-destructive' },
  cancelled: { label: 'Проверка отменена', icon: RotateCcw, className: 'text-muted-foreground' },
  expired: {
    label: 'Прикрепи решение заново',
    icon: ImagePlus,
    className: 'text-muted-foreground',
  },
  unsupported: { label: 'Сверься с решением', icon: BookOpen, className: 'text-muted-foreground' },
  unavailable: {
    label: 'Проверка временно недоступна',
    icon: CircleAlert,
    className: 'text-muted-foreground',
  },
  document_processing: {
    label: 'Готовим страницы PDF',
    icon: Clock,
    className: 'text-muted-foreground',
  },
  pending: { label: 'Проверяем', icon: Clock, className: 'text-muted-foreground' },
  correct: { label: 'Верно', icon: Check, className: 'text-success' },
  partial: { label: 'Есть недочёты', icon: Minus, className: 'text-amber-700 dark:text-amber-300' },
  incorrect: { label: 'Есть ошибка', icon: X, className: 'text-destructive' },
} as const;

export const TRAINING_REVIEW_ATTENTION_STATES: readonly (keyof typeof TRAINING_REVIEW_STATES)[] = [
  'invalid',
  'failed',
  'rejected',
  'cancelled',
  'expired',
  'unsupported',
  'unavailable',
];
