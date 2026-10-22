import { Eraser, Pencil } from 'lucide-react';

import { BRAND } from '@/config/brand';
import { ROUTES } from '@/config/onboarding-steps';

type ExamPart = 1 | 2;

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type TaskStatus = 'unverified' | 'correct' | 'incorrect' | 'partial';
export type TaskHistoryStatus = 'in-progress' | 'correct';
export type EraserTool = 'stroke-eraser' | 'point-eraser';
export type DrawingTool = 'off' | 'pencil' | EraserTool;
export interface DrawingPoint {
  x: number;
  y: number;
}
export interface DrawingStroke {
  id: string;
  points: DrawingPoint[];
  coordinateSpace?: 'workspace' | 'width';
}
export const TASK_ANSWER_INPUT_ID = 'training-answer';
export const TASK_DEFAULT_IMAGE_ASPECT_RATIO = 4 / 3;
export const TASK_IMAGE_SIZES = '(max-width: 768px) 90vw, 28rem';
export const TASK_SOLVED_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});
export const TASK_COUNT_OPTIONS = [3, 5, 10, 20] as const;
export const TRAINING_SETUP = {
  defaultCount: TASK_COUNT_OPTIONS[0],
  minCount: 1,
  examNumberParam: 'examNumber',
} as const;
export const trainingSetupPath = (examNumber?: number) =>
  examNumber === undefined
    ? ROUTES.trainingSetup
    : `${ROUTES.trainingSetup}?${TRAINING_SETUP.examNumberParam}=${examNumber}`;
export const TASK_DIFFICULTY_OPTIONS: Difficulty[] = [1, 2, 3, 4, 5];
export type TaskCount = (typeof TASK_COUNT_OPTIONS)[number] | 'all';

export const TASK_DIFFICULTY_SLIDER = {
  min: 0,
  max: 100,
  step: 1,
  defaultValue: 50,
} as const;

export const TASK_DIFFICULTY_ANCHORS: { level: number; weights: Record<Difficulty, number> }[] = [
  { level: 0, weights: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } },
  { level: 50, weights: { 1: 0.05, 2: 0.45, 3: 0.45, 4: 0.04, 5: 0.01 } },
  { level: 100, weights: { 1: 0, 2: 0, 3: 0, 4: 0.7, 5: 0.3 } },
];

export interface TrainingSettings {
  count: TaskCount;
  difficulties: Difficulty[];
  difficultyLevel?: number;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  count: 10,
  difficulties: TASK_DIFFICULTY_OPTIONS,
  difficultyLevel: TASK_DIFFICULTY_SLIDER.defaultValue,
};

export type TaskRun =
  | { type: 'text'; value: string }
  | { type: 'latex'; value: string }
  | {
      type: 'formula';
      src: string;
      alt?: string;
      width: number;
      height: number;
      heightEm?: number;
      baselineEm?: number;
    };

export interface TaskSource {
  originalPublisher: { name: string; url?: string | null } | null;
  originalReferences: {
    publisher: string | null;
    label: string;
    url: string | null;
    year: number | null;
    examNumber: number | null;
  }[];
}

export const TASK_CONTENT = {
  formulaHeightEm: 1,
  formulaAlignment: 'middle',
  formulaAlt: 'Формула',
  solutionLabel: 'Решение',
  selfReview: 'Открыть ответ и решение без оценки',
};
const TASK_MEDIA_ID = '[0-9a-f-]{36}';
export const TASK_MEDIA_PATTERN = new RegExp(
  `^/(?:tasks/[a-zA-Z0-9._-]+\\.(?:svg|png|jpe?g|webp)|api/(?:catalog-media/${TASK_MEDIA_ID}|daily-task/solution-media/${TASK_MEDIA_ID}|attempts/${TASK_MEDIA_ID}/items/${TASK_MEDIA_ID}/solution-media/${TASK_MEDIA_ID}|(?:school/assignments|expert/works)/${TASK_MEDIA_ID}/task-media/${TASK_MEDIA_ID}))$`,
);

export type TaskBlock =
  | { type: 'text'; value: string }
  | { type: 'latex'; value: string }
  | { type: 'paragraph'; runs: TaskRun[] }
  | {
      type: 'image';
      src: string;
      alt: string;
      aspectRatio?: number;
      colorMode?: 'original' | 'monochrome';
    };

interface TaskProvenance {
  kind: 'original' | 'licensed' | 'official';
  author?: string;
  sourceUrl?: string;
}

export interface TrainingTask {
  id: string;
  examPart: ExamPart;
  examNumber: number;
  topicIds: string[];
  difficulty: Difficulty | null;
  isGrob: boolean;
  content: TaskBlock[];
  acceptedAnswers: string[];
  solution: TaskBlock[];
  provenance: TaskProvenance;
}

interface TaskTopic {
  id: string;
  title: string;
}

interface ExamNumberConfig {
  number: number;
  title: string;
  topicIds: string[];
}

interface ExamPartConfig {
  part: ExamPart;
  numbers: ExamNumberConfig[];
}

const TASK_TOPICS: TaskTopic[] = [
  { id: 'triangle', title: 'Треугольник' },
  { id: 'quadrilateral', title: 'Четырёхугольник' },
  { id: 'circle', title: 'Окружность' },
  { id: 'vector-coordinates', title: 'Координаты вектора' },
  { id: 'vector-length', title: 'Длина вектора' },
  { id: 'vector-operations', title: 'Действия с векторами' },
] as const;

const PART_ONE_NUMBERS: ExamNumberConfig[] = [
  {
    number: 1,
    title: 'Планиметрия',
    topicIds: ['triangle', 'quadrilateral', 'circle'],
  },
  {
    number: 2,
    title: 'Векторы',
    topicIds: ['vector-coordinates', 'vector-length', 'vector-operations'],
  },
  { number: 3, title: 'Стереометрия', topicIds: [] },
  { number: 4, title: 'Теория вероятностей', topicIds: [] },
  { number: 5, title: 'Сложная вероятность', topicIds: [] },
  { number: 6, title: 'Вычисления', topicIds: [] },
  { number: 7, title: 'Уравнения', topicIds: [] },
  { number: 8, title: 'Прикладные задачи', topicIds: [] },
  { number: 9, title: 'Функции', topicIds: [] },
  { number: 10, title: 'Текстовые задачи', topicIds: [] },
  { number: 11, title: 'Графики функций', topicIds: [] },
  { number: 12, title: 'Производная', topicIds: [] },
];

const PART_TWO_NUMBERS: ExamNumberConfig[] = [
  { number: 13, title: 'Уравнения', topicIds: [] },
  { number: 14, title: 'Стереометрия', topicIds: [] },
  { number: 15, title: 'Неравенства', topicIds: [] },
  { number: 16, title: 'Экономические задачи', topicIds: [] },
  { number: 17, title: 'Планиметрия', topicIds: [] },
  { number: 18, title: 'Задачи с параметром', topicIds: [] },
  { number: 19, title: 'Теория чисел', topicIds: [] },
];

const EXAM_PARTS: ExamPartConfig[] = [
  { part: 1, numbers: PART_ONE_NUMBERS },
  { part: 2, numbers: PART_TWO_NUMBERS },
];

export const EXAM_NUMBERS = EXAM_PARTS.flatMap(({ part, numbers }) =>
  numbers.map((number) => ({
    ...number,
    part,
    topics: number.topicIds.flatMap((topicId) => TASK_TOPICS.filter(({ id }) => id === topicId)),
  })),
);

export const TASK_FAVORITES_DIRECT_LIMIT = 5;
export const ALL_TASK_TOPICS = 'all';

export const TASK_COPY = {
  close: 'Закрыть',
  views: [
    { id: 'part-1', label: 'Часть 1' },
    { id: 'part-2', label: 'Часть 2' },
    { id: 'favorites', label: 'Избранное' },
  ],
  allTasks: 'Все задачи',
  examNumberPrefix: '№',
  idPrefix: '#',
  favorites: {
    all: 'Решать все избранные',
    limited: (count: number) => `Решить первые ${count} задач`,
    open: 'Решить задачу',
    empty: 'Сохраняй сложные задачи, чтобы вернуться к ним позже',
    removeTitle: 'Убрать решённые задачи из избранного?',
    remove: 'Убрать',
    keep: 'Оставить',
  },
  soon: 'Скоро',
  catalog: {
    builder: 'Собрать тренировку',
    opening: 'Открываем настройки',
    available: (count: number) => `${count} в банке`,
    solved: (count: number, total: number) => `Решено ${count} из ${total}`,
  },
  setup: {
    title: 'Твоя тренировка',
    subtitle: 'Твой набор задач на сегодня',
    numbers: 'Номера ЕГЭ',
    addNumber: 'Добавить номер',
    chooseNumbers: 'Выбери хотя бы один номер',
    remove: (number: number) => `Убрать №${number}`,
    selectedTopics: (count: number) => `Тем выбрано: ${count}`,
    selectedTasks: (count: number) => `Задач в тренировке: ${count}`,
    tooMany: (max: number) => `В одной тренировке можно до ${max} задач`,
    available: (count: number) => `Доступно задач: ${count}`,
    useAvailable: (count: number) => `Выбрать ${count}`,
    countUnavailable: (count: number) =>
      `На этой сложности доступно задач: ${count}. Выбери меньше или смести ползунок`,
    insufficient:
      'Для выбранной сложности задач не хватает. Уменьши количество или смести ползунок',
    starting: 'Готовим задачи',
    emptyNumber: 'На этой сложности задач пока нет',
    topics: 'Что решаем',
    exam: (number: number, title: string) => `№${number} - ${title}`,
    empty: 'Нет задач с такой сложностью - попробуй другой уровень',
    count: 'Количество задач',
    difficulty: 'Сложность',
    selectionExplainer: 'Как подбираем задачи',
    unratedFallback: 'Задачи без оценки добавим, только если оценённых не хватит',
    selectionRules:
      'На краях выбираем только простые или только сложные задачи, поэтому их может быть меньше. Между краями плавно смешиваем уровни. Задачи без оценки добавляем, только если оценённых не хватает',
    difficultyScale: {
      easy: 'Простые',
      balanced: 'Средние',
      hard: 'Сложные',
    },
    difficultyLevels: {
      easy: 'Только простые задачи',
      easyMedium: 'Больше простых задач',
      balanced: 'Баланс для уверенной практики',
      mediumHard: 'Больше сложных задач',
      hard: 'Сложные задачи и гробы',
    },
    all: 'Все',
    start: 'Начать',
  },
  difficulty: {
    1: 'Уровень 1',
    2: 'Уровень 2',
    3: 'Уровень 3',
    4: 'Уровень 4',
    5: 'Уровень 5 - гроб',
    unknown: 'Сложность не указана',
  },
  training: {
    task: 'Задание',
    solved: (date: string) => `Решено ${date}`,
    exit: 'Сохранить и выйти',
    favorite: 'Добавить в избранное',
    pencil: 'Карандаш',
    strokeEraser: 'Стереть линию целиком',
    pointEraser: 'Ластик - стереть часть линии',
    workspace: 'Рабочая область задания',
    answer: 'Введи ответ',
    clearAnswer: 'Очистить ответ',
    navigation: 'Навигация по заданиям',
    previous: 'Предыдущее задание',
    next: 'Следующее задание',
    toReview: 'К проверке',
    solution: 'Посмотреть решение',
    hideSolution: 'Свернуть решение',
  },
  review: {
    title: 'Проверь тренировку',
    missing: 'Без ответа:',
    answered: (count: number, total: number) => `${count} из ${total} с ответом`,
    complete: 'Все ответы заполнены',
    openTask: (number: number) => `Вернуться к заданию ${number}`,
    task: (number: number) => `Задание ${number}`,
    check: 'Проверить',
    continue: 'Продолжить тренировку',
  },
} as const;

const ORIGINAL_PROVENANCE: TaskProvenance = {
  kind: 'original',
  author: BRAND.name,
};

export const TRAINING_TASKS: TrainingTask[] = [
  {
    id: 'planimetry-triangle-001',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 1,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'В прямоугольном треугольнике катеты равны 6 и 8. Найди гипотенузу',
      },
      { type: 'latex', value: 'c = \\sqrt{a^2 + b^2}' },
    ],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: 'c = \\sqrt{6^2 + 8^2} = \\sqrt{100} = 10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-001',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 1,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Длина прямоугольника равна 9, а ширина - 4. Найди его площадь',
      },
    ],
    acceptedAnswers: ['36'],
    solution: [{ type: 'latex', value: 'S = 9 \\cdot 4 = 36' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-002',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 3,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'В равнобедренном треугольнике боковые стороны равны 5, а основание - 6. Найди высоту, проведённую к основанию',
      },
      {
        type: 'image',
        src: '/tasks/isosceles-triangle.svg',
        alt: 'Равнобедренный треугольник с высотой к основанию',
        aspectRatio: 1.6,
        colorMode: 'monochrome',
      },
    ],
    acceptedAnswers: ['4'],
    solution: [
      {
        type: 'text',
        value: 'Высота делит основание пополам, поэтому катет малого треугольника равен 3',
      },
      { type: 'latex', value: 'h = \\sqrt{5^2 - 3^2} = 4' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-001',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 3,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'Центральный угол AOB равен 120°. Найди вписанный угол ACB, опирающийся на ту же дугу AB',
      },
    ],
    acceptedAnswers: ['60'],
    solution: [
      {
        type: 'text',
        value: 'Вписанный угол равен половине центрального угла, опирающегося на ту же дугу',
      },
      { type: 'latex', value: '\\angle ACB = \\frac{120^\\circ}{2} = 60^\\circ' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-002',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral', 'circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'Около окружности радиуса 3 описана трапеция, периметр которой равен 30. Найди площадь трапеции',
      },
      {
        type: 'image',
        src: '/tasks/circumscribed-trapezoid.svg',
        alt: 'Трапеция, описанная около окружности',
        aspectRatio: 1.25,
        colorMode: 'monochrome',
      },
    ],
    acceptedAnswers: ['45'],
    solution: [
      {
        type: 'text',
        value:
          'Высота трапеции равна диаметру окружности, а сумма оснований описанной трапеции равна полупериметру',
      },
      { type: 'latex', value: 'h = 6, \\quad a + b = 15' },
      { type: 'latex', value: 'S = \\frac{a+b}{2} \\cdot h = \\frac{15}{2} \\cdot 6 = 45' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-003',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle', 'circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'Равносторонний треугольник вписан в окружность радиуса 4. Найди площадь треугольника, делённую на корень из трёх',
      },
      { type: 'latex', value: 'R = 4' },
    ],
    acceptedAnswers: ['12'],
    solution: [
      { type: 'latex', value: 'a = R\\sqrt{3} = 4\\sqrt{3}' },
      { type: 'latex', value: 'S = \\frac{a^2\\sqrt{3}}{4} = 12\\sqrt{3}' },
      { type: 'latex', value: '\\frac{S}{\\sqrt{3}} = 12' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-004',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 1,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Основание треугольника равно 10, высота к нему равна 4. Найди площадь',
      },
    ],
    acceptedAnswers: ['20'],
    solution: [{ type: 'latex', value: 'S = \\frac{10 \\cdot 4}{2} = 20' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-002',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Диаметр окружности равен 14. Найди её радиус' }],
    acceptedAnswers: ['7'],
    solution: [{ type: 'latex', value: 'r = \\frac{14}{2} = 7' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-003',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Сторона квадрата равна 6. Найди его периметр' }],
    acceptedAnswers: ['24'],
    solution: [{ type: 'latex', value: 'P = 4 \\cdot 6 = 24' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-005',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Два угла треугольника равны 45° и 65°. Найди третий угол' }],
    acceptedAnswers: ['70'],
    solution: [{ type: 'latex', value: '180^\\circ - 45^\\circ - 65^\\circ = 70^\\circ' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-003',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Радиус окружности равен 5. Найди её диаметр' }],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: 'd = 2r = 10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-004',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Периметр квадрата равен 36. Найди его сторону' }],
    acceptedAnswers: ['9'],
    solution: [{ type: 'latex', value: 'a = \\frac{36}{4} = 9' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-006',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 3,
    isGrob: false,
    content: [
      { type: 'text', value: 'Катеты прямоугольного треугольника равны 9 и 12. Найди гипотенузу' },
    ],
    acceptedAnswers: ['15'],
    solution: [{ type: 'latex', value: 'c = \\sqrt{9^2 + 12^2} = 15' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-005',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 3,
    isGrob: false,
    content: [{ type: 'text', value: 'Диагонали ромба равны 8 и 10. Найди его площадь' }],
    acceptedAnswers: ['40'],
    solution: [{ type: 'latex', value: 'S = \\frac{8 \\cdot 10}{2} = 40' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-004',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 3,
    isGrob: false,
    content: [{ type: 'text', value: 'Длина окружности равна 18π. Найди её радиус' }],
    acceptedAnswers: ['9'],
    solution: [{ type: 'latex', value: '2\\pi r = 18\\pi, \\quad r = 9' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-007',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 3,
    isGrob: false,
    content: [
      { type: 'text', value: 'Средняя линия треугольника равна 7. Найди параллельную ей сторону' },
    ],
    acceptedAnswers: ['14'],
    solution: [{ type: 'latex', value: 'a = 2 \\cdot 7 = 14' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-006',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 3,
    isGrob: false,
    content: [
      { type: 'text', value: 'Основания трапеции равны 5 и 11, высота равна 3. Найди площадь' },
    ],
    acceptedAnswers: ['24'],
    solution: [{ type: 'latex', value: 'S = \\frac{5 + 11}{2} \\cdot 3 = 24' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-005',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 3,
    isGrob: false,
    content: [{ type: 'text', value: 'Площадь круга равна 49π. Найди радиус окружности' }],
    acceptedAnswers: ['7'],
    solution: [{ type: 'latex', value: '\\pi r^2 = 49\\pi, \\quad r = 7' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-008',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle'],
    difficulty: 4,
    isGrob: false,
    content: [{ type: 'text', value: 'Стороны треугольника равны 13, 14 и 15. Найди его площадь' }],
    acceptedAnswers: ['84'],
    solution: [
      { type: 'latex', value: 'p = 21, \\quad S = \\sqrt{21 \\cdot 8 \\cdot 7 \\cdot 6} = 84' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-007',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Сторона ромба равна 10, одна диагональ равна 12. Найди вторую диагональ',
      },
    ],
    acceptedAnswers: ['16'],
    solution: [
      {
        type: 'latex',
        value:
          '\\left(\\frac{12}{2}\\right)^2 + \\left(\\frac{d}{2}\\right)^2 = 10^2, \\quad d = 16',
      },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-006',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Хорда длины 16 находится на расстоянии 6 от центра окружности. Найди радиус',
      },
    ],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: 'r = \\sqrt{8^2 + 6^2} = 10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-triangle-009',
    examPart: 1,
    examNumber: 1,
    topicIds: ['triangle', 'circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'В прямоугольном треугольнике гипотенуза равна 20. Найди радиус описанной окружности',
      },
    ],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: 'R = \\frac{c}{2} = 10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-quadrilateral-008',
    examPart: 1,
    examNumber: 1,
    topicIds: ['quadrilateral', 'circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      { type: 'text', value: 'Квадрат вписан в окружность радиуса 5√2. Найди сторону квадрата' },
    ],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: 'a\\sqrt{2} = 2R = 10\\sqrt{2}, \\quad a = 10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'planimetry-circle-007',
    examPart: 1,
    examNumber: 1,
    topicIds: ['circle'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value:
          'Из точки к окружности проведены касательная длины 12 и секущая с внешней частью 8. Найди длину всей секущей',
      },
    ],
    acceptedAnswers: ['18'],
    solution: [{ type: 'latex', value: '12^2 = 8x, \\quad x = 18' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-001',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 1,
    isGrob: false,
    content: [
      { type: 'text', value: 'Даны точки A(1; 2) и B(5; 2). Найди первую координату вектора AB' },
    ],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: '\\overrightarrow{AB}=(5-1;2-2)=(4;0)' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-001',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Найди длину вектора с координатами (3; 4)' }],
    acceptedAnswers: ['5'],
    solution: [{ type: 'latex', value: '|\\vec a|=\\sqrt{3^2+4^2}=5' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-001',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 1,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Даны векторы a = (2; 1) и b = (3; 4). Найди первую координату вектора a + b',
      },
    ],
    acceptedAnswers: ['5'],
    solution: [{ type: 'latex', value: '\\vec a+\\vec b=(2+3;1+4)=(5;5)' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-002',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 1,
    isGrob: false,
    content: [
      { type: 'text', value: 'Даны точки A(-2; 3) и B(1; 7). Найди вторую координату вектора AB' },
    ],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: '\\overrightarrow{AB}=(1-(-2);7-3)=(3;4)' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-002',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 1,
    isGrob: false,
    content: [{ type: 'text', value: 'Найди длину вектора с координатами (0; -7)' }],
    acceptedAnswers: ['7'],
    solution: [{ type: 'latex', value: '|\\vec a|=\\sqrt{0^2+(-7)^2}=7' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-002',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 1,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Вектор a имеет координаты (4; -2). Найди вторую координату вектора 3a',
      },
    ],
    acceptedAnswers: ['-6'],
    solution: [{ type: 'latex', value: '3\\vec a=(12;-6)' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-003',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 3,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Вектор AB равен (6; -3), точка A имеет координаты (2; 5). Найди абсциссу точки B',
      },
    ],
    acceptedAnswers: ['8'],
    solution: [{ type: 'latex', value: 'x_B-2=6,\\quad x_B=8' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-003',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 3,
    isGrob: false,
    content: [{ type: 'text', value: 'Найди длину вектора AB, если A(-1; 2), B(5; 10)' }],
    acceptedAnswers: ['10'],
    solution: [
      { type: 'latex', value: '\\overrightarrow{AB}=(6;8),\\quad |\\overrightarrow{AB}|=10' },
    ],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-003',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 3,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Даны векторы a = (5; 2) и b = (1; -3). Найди сумму координат вектора a - b',
      },
    ],
    acceptedAnswers: ['9'],
    solution: [{ type: 'latex', value: '\\vec a-\\vec b=(4;5),\\quad 4+5=9' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-004',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 3,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Середина отрезка AB равна M(4; 1), A(1; -2). Найди ординату точки B',
      },
    ],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: '\\frac{-2+y_B}{2}=1,\\quad y_B=4' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-004',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 3,
    isGrob: false,
    content: [
      { type: 'text', value: 'Длина вектора (x; 8) равна 10, причём x положителен. Найди x' },
    ],
    acceptedAnswers: ['6'],
    solution: [{ type: 'latex', value: 'x^2+8^2=10^2,\\quad x=6' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-004',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 3,
    isGrob: false,
    content: [{ type: 'text', value: 'Найди скалярное произведение векторов (2; 3) и (4; -1)' }],
    acceptedAnswers: ['5'],
    solution: [{ type: 'latex', value: '(2;3)\\cdot(4;-1)=2\\cdot4+3\\cdot(-1)=5' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-005',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Точка C делит AB в отношении AC:CB = 2:1. A(-2; 1), B(7; 4). Найди абсциссу C',
      },
    ],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: 'x_C=\\frac{x_A+2x_B}{3}=\\frac{-2+14}{3}=4' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-005',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Векторы a и b перпендикулярны, их длины равны 6 и 8. Найди длину a + b',
      },
    ],
    acceptedAnswers: ['10'],
    solution: [{ type: 'latex', value: '|\\vec a+\\vec b|=\\sqrt{6^2+8^2}=10' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-005',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 4,
    isGrob: false,
    content: [{ type: 'text', value: 'При каком x векторы (x; 2) и (3; -6) перпендикулярны' }],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: '3x+2\\cdot(-6)=0,\\quad x=4' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-coordinates-006',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-coordinates'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Точка M(3; -1) - середина AB. Вектор AB равен (8; 6). Найди абсциссу точки A',
      },
    ],
    acceptedAnswers: ['-1'],
    solution: [{ type: 'latex', value: 'x_A=3-\\frac{8}{2}=-1' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-length-006',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-length'],
    difficulty: 4,
    isGrob: false,
    content: [
      {
        type: 'text',
        value: 'Длины векторов a и b равны 5, а угол между ними равен 60°. Найди длину a - b',
      },
    ],
    acceptedAnswers: ['5'],
    solution: [{ type: 'latex', value: '|\\vec a-\\vec b|^2=25+25-2\\cdot25\\cdot\\frac12=25' }],
    provenance: ORIGINAL_PROVENANCE,
  },
  {
    id: 'vectors-operations-006',
    examPart: 1,
    examNumber: 2,
    topicIds: ['vector-operations'],
    difficulty: 4,
    isGrob: false,
    content: [
      { type: 'text', value: 'Векторы (2; x) и (x; 8) коллинеарны, x положителен. Найди x' },
    ],
    acceptedAnswers: ['4'],
    solution: [{ type: 'latex', value: '\\frac{2}{x}=\\frac{x}{8},\\quad x^2=16,\\quad x=4' }],
    provenance: ORIGINAL_PROVENANCE,
  },
];

export const TRAINING_DRAWING_TOOLS = [
  { id: 'pencil', label: TASK_COPY.training.pencil, icon: Pencil },
  { id: 'stroke-eraser', label: TASK_COPY.training.strokeEraser, icon: Eraser },
  { id: 'point-eraser', label: TASK_COPY.training.pointEraser, icon: null },
] as const;
