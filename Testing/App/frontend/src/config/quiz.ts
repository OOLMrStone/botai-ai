export const QUIZ_COPY = {
  title: 'Квизы',
  close: 'Выйти из квиза',
  catalog: 'К квизам',
  setupTitles: { trigonometry: 'Вспомним\nформулы?', probability: 'Проверим\nинтуицию?' },
  difficulty: 'Сложность',
  duration: 'Сколько есть времени?',
  start: 'Начать квиз',
  check: 'Проверить',
  next: 'Дальше',
  finish: 'Посмотреть результат',
  correct: 'Именно так!',
  incorrect: 'Давай разберёмся',
  correctAnswer: 'Верный ответ',
  result: 'Ещё немного понятнее',
  perfectResult: 'Отличный результат!',
  resultOf: 'из',
  again: 'Пройти ещё раз',
  resultNote: 'Ошибки тоже работают на тебя: теперь ты знаешь, на что обратить внимание',
  perfectNote: 'Все идеи на месте. Закрепи их ещё раз или попробуй другую тему',
  progress: 'Прогресс квиза',
} as const;

export const QUIZ_DIFFICULTIES = [
  { id: 'basic', title: 'Разминка' },
  { id: 'challenge', title: 'С вызовом' },
] as const;

export const QUIZ_LENGTHS = [
  { id: 3, title: '≈ 2 минуты', description: '3 шага' },
  { id: 6, title: '≈ 5 минут', description: '6 шагов' },
  { id: 12, title: '≈ 10 минут', description: '12 шагов' },
  { id: 20, title: '≈ 15 минут', description: '20 шагов' },
] as const;

export const QUIZ_DURATION_SLIDER = { min: 0, max: QUIZ_LENGTHS.length - 1, step: 1 } as const;

export const QUIZ_FORMULA_FIT = { minScale: 0.72, maxScale: 1 } as const;
