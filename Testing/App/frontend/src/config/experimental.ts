export type ExperimentalPointId =
  | 'domain'
  | 'substitution'
  | 'algebra'
  | 'intervals'
  | 'lost-point'
  | 'back-substitution'
  | 'answer';

export type ExperimentalPointStatus = 'correct' | 'error' | 'inherited' | 'note';

export interface ExperimentalPoint {
  id: ExperimentalPointId;
  elementId: string;
  title: string;
  status: ExperimentalPointStatus;
  explanation: string;
  math?: string;
  detail?: string;
  formattingNote?: string;
  formattingFormula?: string;
}

export interface ExperimentalSolutionSection {
  id: string;
  number: string;
  title: string;
  formulas: string[];
  pointId?: ExperimentalPointId;
  kind: 'formulas' | 'intervals';
  layout?: 'columns';
  width?: 'half';
}

export const EXPERIMENTAL = {
  studentId: 'petya-vasechkin',
  taskId: 'inequality-15-1',
  taskNumber: 16,
  taskCount: 3,
  score: 1,
  maxScore: 2,
  minScore: 0,
  feedbackMs: 3_600,
  revealTimeoutMs: 1_000,
  revealInsetPx: 12,
  revealTolerancePx: 2,
  documentSelector: '[data-experimental-document]',
  solutionHeaderSelector: '[data-experimental-solution-header]',
  sourceImage: '/experimental/student-solution.jpeg',
} as const;

export const EXPERIMENTAL_MATH = {
  task: '\\frac{3^x+9}{3^x-9}+\\frac{3^x-9}{3^x+9}\\geq\\frac{4\\cdot3^{x+1}+144}{9^x-81}',
  domain:
    '\\begin{cases}3^x-9\\ne0\\\\3^x+9\\ne0\\\\9^x-81\\ne0\\end{cases}\\quad\\Rightarrow\\quad\\begin{cases}x\\ne2\\\\x\\ne2\\end{cases}',
  compactDomain: 'x\\ne2',
  compactDomainText: 'x ≠ 2',
  substitution: 't=3^x,\\qquad t>0',
  substituted: '\\frac{t+9}{t-9}+\\frac{t-9}{t+9}\\geq\\frac{12t+144}{t^2-81}',
  combined: '\\frac{(t+9)^2+(t-9)^2-12t-144}{(t-9)(t+9)}\\geq0',
  simplified: '\\frac{2t^2-12t+18}{(t-9)(t+9)}\\geq0',
  factored: '\\frac{(t-3)^2}{(t-9)(t+9)}\\geq0',
  studentInterval: 't>9',
  correctInterval: 't=3\\quad\\text{или}\\quad t>9',
  backSubstitution: '3^x>9\\quad\\Rightarrow\\quad3^x>3^2\\quad\\Rightarrow\\quad x>2',
  studentAnswer: 'x\\in(2;+\\infty)',
  correctAnswer: 'x\\in\\{1\\}\\cup(2;+\\infty)',
  isolatedPoint: 't=3\\quad\\Rightarrow\\quad3^x=3\\quad\\Rightarrow\\quad x=1',
} as const;

export const EXPERIMENTAL_STUDENTS = [
  {
    id: EXPERIMENTAL.studentId,
    name: 'Петя Васечкин',
    initials: 'ПВ',
    subject: 'Профильная математика',
    tasks: EXPERIMENTAL.taskCount,
    submittedAt: 'больше 2 дней назад',
    submittedAgoMinutes: 3_060,
    active: true,
  },
  {
    id: 'vova-sidorov',
    name: 'Вова Сидоров',
    initials: 'ВС',
    subject: 'Профильная математика',
    tasks: 4,
    submittedAt: '1 день назад',
    submittedAgoMinutes: 1_680,
    active: false,
  },
  {
    id: 'vasya-petrov',
    name: 'Вася Петров',
    initials: 'ВП',
    subject: 'Профильная математика',
    tasks: 6,
    submittedAt: '7 часов назад',
    submittedAgoMinutes: 420,
    active: false,
  },
  {
    id: 'lena-ivanova',
    name: 'Лена Иванова',
    initials: 'ЛИ',
    subject: 'Профильная математика',
    tasks: 3,
    submittedAt: '47 минут назад',
    submittedAgoMinutes: 47,
    active: false,
  },
] as const;

export const EXPERIMENTAL_POINTS: Record<ExperimentalPointId, ExperimentalPoint> = {
  domain: {
    id: 'domain',
    elementId: 'experimental-point-domain',
    title: 'ОДЗ посчитано верно',
    status: 'correct',
    explanation: 'Знаменатели обращаются в ноль только при x = 2',
    formattingNote: 'Объедини одинаковые ограничения в одну итоговую запись',
    formattingFormula: EXPERIMENTAL_MATH.compactDomain,
  },
  substitution: {
    id: 'substitution',
    elementId: 'experimental-point-substitution',
    title: 'Замена введена верно',
    status: 'correct',
    explanation: 'Показательная функция всегда положительна, поэтому t > 0',
  },
  algebra: {
    id: 'algebra',
    elementId: 'experimental-point-algebra',
    title: 'Преобразования верны',
    status: 'correct',
    explanation: 'Дроби приведены к общему знаменателю, числитель свёрнут в квадрат',
    math: EXPERIMENTAL_MATH.factored,
  },
  intervals: {
    id: 'intervals',
    elementId: 'experimental-point-intervals',
    title: 'Знаки расставлены верно',
    status: 'correct',
    explanation: 'В точке t = 3 числитель равен нулю, а знак дроби не меняется',
    detail: 'Точки −9 и 9 исключены, точка 3 включена',
  },
  'lost-point': {
    id: 'lost-point',
    elementId: 'experimental-point-lost-point',
    title: 'Потеряна точка t = 3',
    status: 'error',
    explanation:
      'Неравенство нестрогое: при t = 3 дробь равна нулю. Эта точка тоже входит в решение',
    math: EXPERIMENTAL_MATH.correctInterval,
    detail: 'Одна ошибка при отборе решений - максимум 1 балл из 2',
  },
  'back-substitution': {
    id: 'back-substitution',
    elementId: 'experimental-point-back-substitution',
    title: 'Верно из предыдущего шага',
    status: 'inherited',
    explanation:
      'Из t > 9 верно получено x > 2. Это следствие пропущенной точки, а не новая ошибка',
  },
  answer: {
    id: 'answer',
    elementId: 'experimental-point-answer',
    title: 'В ответе не хватает x = 1',
    status: 'inherited',
    explanation: 'Пропущенная точка t = 3 даёт x = 1. Повторно балл за это не снижается',
    math: EXPERIMENTAL_MATH.correctAnswer,
  },
};

export const EXPERIMENTAL_SOLUTION: ExperimentalSolutionSection[] = [
  {
    id: 'task',
    number: String(EXPERIMENTAL.taskNumber),
    title: 'Реши неравенство',
    formulas: [EXPERIMENTAL_MATH.task],
    kind: 'formulas',
  },
  {
    id: 'domain',
    number: '01',
    title: 'Область допустимых значений',
    formulas: [EXPERIMENTAL_MATH.domain],
    pointId: 'domain',
    kind: 'formulas',
    width: 'half',
  },
  {
    id: 'substitution',
    number: '02',
    title: 'Замена переменной',
    formulas: [EXPERIMENTAL_MATH.substitution],
    pointId: 'substitution',
    kind: 'formulas',
    width: 'half',
  },
  {
    id: 'algebra',
    number: '03',
    title: 'Преобразование неравенства',
    formulas: [
      EXPERIMENTAL_MATH.substituted,
      EXPERIMENTAL_MATH.combined,
      EXPERIMENTAL_MATH.simplified,
      EXPERIMENTAL_MATH.factored,
    ],
    pointId: 'algebra',
    kind: 'formulas',
    layout: 'columns',
  },
  {
    id: 'intervals',
    number: '04',
    title: 'Метод интервалов',
    formulas: [],
    pointId: 'intervals',
    kind: 'intervals',
  },
  {
    id: 'lost-point',
    number: '05',
    title: 'Отбор решений',
    formulas: [EXPERIMENTAL_MATH.studentInterval],
    pointId: 'lost-point',
    kind: 'formulas',
  },
  {
    id: 'back-substitution',
    number: '06',
    title: 'Обратная замена',
    formulas: [EXPERIMENTAL_MATH.backSubstitution],
    pointId: 'back-substitution',
    kind: 'formulas',
  },
  {
    id: 'answer',
    number: '07',
    title: 'Ответ ученика',
    formulas: [EXPERIMENTAL_MATH.studentAnswer],
    pointId: 'answer',
    kind: 'formulas',
  },
];

export const EXPERIMENTAL_COPY = {
  verdict: 'Обоснованно получен ответ, отличающийся от верного исключением точки 1',
  advice: `При знаке ≥ проверяй нули числителя отдельно: точка t = 3 даёт решение x = 1\n\n${EXPERIMENTAL_POINTS.domain.formattingNote}: ${EXPERIMENTAL_MATH.compactDomainText}`,
  sourceAlt: 'Фото решения Пети Васечкина',
  editSaved: 'Изменения сохранены',
  confirmed: 'Оценка подтверждена',
  disputeAdded: 'Шаг отмечен для пересмотра',
  disputeRemoved: 'Отметка снята',
  solution: {
    title: 'Решение ученика',
    subtitle: 'Распознано и структурировано',
    dispute: 'Не согласен',
    undispute: 'Снять отметку',
    closeComment: 'Закрыть комментарий',
    disputed: 'Отмечено для пересмотра',
    correct: 'Верный шаг',
    error: 'Ошибка',
    inherited: 'Следствие ошибки',
    note: 'Оформление',
    formatting: 'Совет по оформлению',
    noPenalty: 'Без снижения балла',
    step: 'Шаг',
    explanation: 'Комментарий ИИ',
    original: 'Оригинал',
    task: `Задание ${EXPERIMENTAL.taskNumber}`,
    taskLabel: 'Условие задачи',
    intervalLabel: 'Интервальная прямая: точка 3 и промежуток t > 9',
    intervalDomain: 'При t > 0',
    axisLabel: 't',
    plus: '+',
    minus: '−',
  },
} as const;
