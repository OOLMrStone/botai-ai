export const ATTEMPT_TITLE_MAX_LENGTH = 80;
export const HOME_ATTEMPT_MEASUREMENT_RESERVE = 1;
export const ATTEMPT_ENDPOINTS = {
  exit: (id: string) => `/api/attempts/${id}/exit`,
} as const;

export const ATTEMPT_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unfinished', label: 'Начатые' },
  { id: 'completed', label: 'Результаты' },
] as const;

export type AttemptFilter = (typeof ATTEMPT_FILTERS)[number]['id'];

export const ATTEMPT_COPY = {
  homeTitle: 'Твои подборки',
  historySubtitle: 'Продолжай начатое и возвращайся к результатам',
  historyLink: 'История',
  newTraining: 'К задачам',
  training: 'Тренировка',
  exam: 'Пробник',
  continue: 'Продолжить',
  result: 'Посмотреть результат',
  checkProgress: 'Открыть проверку',
  notStarted: (total: number) => `Задач в подборке: ${total}`,
  progress: (answered: number, total: number) => `Ответил на ${answered} из ${total}`,
  completed: (earned: number, max: number) => `Баллы: ${earned} из ${max}`,
  checking: 'Проверяем твои ответы',
  renameLabel: (title: string) => `Переименовать «${title}»`,
  renameTitle: 'Название подборки',
  renameHint: 'Назови так, чтобы легко найти потом',
  nameLabel: 'Название',
  namePlaceholder: 'Например, геометрия к контрольной',
  nameRequired: 'Введи название подборки',
  deleteLabel: (title: string) => `Удалить «${title}»`,
  deleteTitle: 'Удалить из истории?',
  deleteDescription: (title: string) =>
    `«${title}» исчезнет с главной и из истории. Твои достижения и время занятий сохранятся`,
  deleteAction: 'Удалить',
  deleting: 'Удаляем',
  deleteError: 'Не получилось удалить. Попробуй ещё раз',
  save: 'Сохранить',
  cancel: 'Отмена',
  close: 'Закрыть',
  emptyTitle: 'С чего начнём?',
  emptyDescription: 'Выбери номер ЕГЭ или собери тренировку под себя',
  emptyHistoryTitle: 'Здесь будут твои решения',
  emptyHistoryDescription: 'Начни тренировку - ответы и результаты сохранятся здесь',
  emptyUnfinishedTitle: 'Всё закончено',
  emptyUnfinishedDescription: 'Можно выбрать новые задачи или посмотреть результаты',
  emptyCompletedTitle: 'Результаты впереди',
  emptyCompletedDescription: 'Закончи подборку и проверь ответы, чтобы увидеть результат',
  showAll: 'Все подборки',
  loadingLabel: 'Загружаем подборки',
  exitError: 'Не получилось сохранить выход. Попробуй ещё раз',
} as const;

export const ATTEMPT_SKELETONS = ['first', 'second', 'third'] as const;
