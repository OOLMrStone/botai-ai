import { EXPERIMENTAL, EXPERIMENTAL_STUDENTS } from '@/config/experimental';

export const EXPERIMENTAL_WORKSPACE = {
  student: EXPERIMENTAL_STUDENTS.find((student) => student.id === EXPERIMENTAL.studentId)!,
  taskTabs: Array.from({ length: EXPERIMENTAL.taskCount }, (_, index) => ({
    id: index,
    label: `Задача ${index + 1}`,
    active: index === 0,
  })),
  scoreOptions: Array.from({ length: EXPERIMENTAL.maxScore + 1 }, (_, index) => index),
  pendingCount: EXPERIMENTAL_STUDENTS.length,
  columns: ['Ученик', 'Предмет', 'Количество', 'Получено', 'Статус'],
} as const;

export const EXPERIMENTAL_QUEUE = {
  defaultSort: 'oldest',
  sortOptions: [
    { id: 'oldest', label: 'Сначала давние', direction: -1 },
    { id: 'newest', label: 'Сначала новые', direction: 1 },
  ],
  taskPlural: new Intl.PluralRules('ru-RU'),
  taskUnits: {
    one: 'задача',
    few: 'задачи',
    many: 'задач',
    other: 'задачи',
    zero: 'задач',
    two: 'задачи',
  },
} as const;

export type ExperimentalQueueSort = (typeof EXPERIMENTAL_QUEUE.sortOptions)[number]['id'];

export const EXPERIMENTAL_WORKSPACE_COPY = {
  expert: 'Кабинет эксперта',
  expertInitials: 'Э',
  queueTitle: 'Работы на проверку',
  queueSubtitle: 'ИИ проверил решение. Последнее слово за тобой',
  queueTab: 'Ждут проверки',
  queueReady: 'Разбор ИИ готов',
  queueStart: 'Начать проверку',
  queueSearch: 'Найти ученика',
  queueSort: 'Порядок работ',
  queueEmptyTitle: 'Ученик не найден',
  queueEmptyHint: 'Попробуй другое имя или сбрось поиск',
  queueReset: 'Сбросить поиск',
  back: 'Все работы',
  tasks: (count: number) =>
    `${count} ${EXPERIMENTAL_QUEUE.taskUnits[EXPERIMENTAL_QUEUE.taskPlural.select(count)]}`,
  workDescription: `№ ${EXPERIMENTAL.taskNumber} · ${EXPERIMENTAL.taskCount} ${EXPERIMENTAL_QUEUE.taskUnits[EXPERIMENTAL_QUEUE.taskPlural.select(EXPERIMENTAL.taskCount)]}`,
  verdictTitle: 'Оценка ИИ',
  expertVerdictTitle: 'Оценка эксперта',
  pending: 'На согласовании',
  approved: 'Подтверждена',
  outOf: (max: number) => `из ${max} баллов`,
  criterion: 'Критерий оценки',
  editVerdict: 'Изменить оценку',
  findingTitle: 'Одна потерянная точка',
  deduction: '-1 балл',
  findingDescription: 'На прямой точка t = 3 включена, но в отбор решений не попала',
  findingLink: 'Показать в решении',
  consequence: 'Обратная замена и ответ следуют из этой ошибки. Второго снижения нет',
  adviceTitle: 'Советы ученику',
  editAdvice: 'Редактировать советы',
  confirm: 'Подтвердить оценку',
  confirmed: 'Оценка подтверждена',
  confirmationHint: 'Оценка и комментарий готовы для ученика',
  confirmedHint: 'Оценка и комментарий сохранены',
  source: 'Фото решения',
  sourceFullSize: 'Открыть в отдельной вкладке',
  sourceHint: 'Сверить с рукописью',
  close: 'Закрыть',
  cancel: 'Отмена',
  save: 'Сохранить',
  scoreLabel: 'Балл',
  verdictLabel: 'Обоснование оценки',
  adviceLabel: 'Комментарий ученику',
  criterionTitle: 'Почему 1 балл',
  criterionLabel: 'Критерий для этой работы',
  criterionScore: '1 балл из 2',
  criterionOrigin: 'Основание экспертной оценки этой работы',
  referenceTitle: 'Верный ответ',
  lostPointTitle: 'Пропущенная точка',
} as const;
