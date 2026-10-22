import { IS_MOCK_API } from '@/config/env';
import type { TaskBlock } from '@/config/tasks';

export const MOCK_EXAM_DEMO = {
  enabled: IS_MOCK_API,
  examId: 'variant-01',
  taskId: 'demo-2025-13',
  taskQueryKey: 'task',
  taskNumber: 13,
  storageKey: 'botai-mock-exam-demo',
  resetRevision: 2,
  photoMs: 500,
  solutionMs: 20_000,
  fileAccept: 'image/*',
  imageMimePrefix: 'image/',
  score: 2,
  maxScore: 2,
} as const;

export const MOCK_EXAM_DEMO_CONTENT: TaskBlock[] = [
  { type: 'text', value: 'а) Решите уравнение' },
  { type: 'latex', value: '8\\cos^4 x+3\\cos 2x-6=0' },
  { type: 'text', value: 'б) Укажите корни этого уравнения, принадлежащие отрезку' },
  { type: 'latex', value: '\\left[-\\frac{7\\pi}{2};-2\\pi\\right]' },
];

export const MOCK_EXAM_DEMO_COPY = {
  photo: 'Проверяем фото',
  ready: 'Фотографии готовы к проверке',
  solution: 'Проверяем решение',
  title: 'Результат проверки',
  score: (score: number, max: number) => `${score} из ${max}`,
  outOf: (max: number) => `из ${max}`,
  withFormatting: 'С учётом оформления',
  withoutFormatting: 'Без учёта оформления',
  learningMetric: 'Учебный показатель',
  improvements: 'Что можно улучшить',
  tips: [
    {
      title: 'Пиши цифры разборчивее',
      description: 'Некоторые цифры трудно разобрать даже человеку',
    },
    {
      title: 'Записывай решение по порядку',
      description: 'Сверху вниз, слева направо - так легче следить за ходом решения',
    },
  ],
  reattach: 'Прикрепить заново',
  photoAlt: 'Прикреплённое фото решения',
  invalidFile: 'Выбери фото решения',
  failed: 'Не получилось проверить фото. Прикрепи его ещё раз',
  example: 'Улучши оформление',
  exampleIntro: 'После квадратного уравнения покажи отбор допустимого корня',
  exampleSteps: [
    { title: 'Сделай замену', formula: 't=\\cos^2 x,\\quad 8t^2+6t-9=0' },
    { title: 'Найди оба корня', formula: 't_1=\\frac34,\\quad t_2=-\\frac32' },
    {
      title: 'Объясни отбор',
      formula: 't=\\cos^2 x\\ge 0\\Rightarrow t_2\\text{ не подходит}',
    },
  ],
  exampleResult: 'Остаётся только cos²x = 3/4',
} as const;
