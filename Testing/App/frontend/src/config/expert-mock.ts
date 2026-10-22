import {
  EXPERIMENTAL,
  EXPERIMENTAL_COPY,
  EXPERIMENTAL_MATH,
  EXPERIMENTAL_POINTS,
  EXPERIMENTAL_SOLUTION,
  EXPERIMENTAL_STUDENTS,
  type ExperimentalPointStatus,
} from '@/config/experimental';
import { EXPERIMENTAL_WORKSPACE_COPY } from '@/config/experimental-workspace';
import {
  EXPERT,
  type ExpertBlock,
  type ExpertBlockStatus,
  type ExpertStudent,
  type ExpertTask,
} from '@/config/expert';

const STATUS: Record<ExperimentalPointStatus, ExpertBlockStatus> = {
  correct: 'correct',
  error: 'error',
  inherited: 'follow_through',
  note: 'warning',
};

export const EXPERT_MOCK_STUDENTS: ExpertStudent[] = [
  ...EXPERIMENTAL_STUDENTS.map(({ id, name, initials }) => ({
    id,
    name,
    initials,
    email: `${id}@example.test`,
    contact: '',
  })),
  {
    id: 'anna-smirnova',
    name: 'Анна Смирнова',
    initials: 'АС',
    email: 'anna-smirnova@example.test',
    contact: '@anna_demo',
  },
];

const inequalityBlocks: ExpertBlock[] = EXPERIMENTAL_SOLUTION.filter(
  (section) => section.pointId,
).map((section) => {
  const point = EXPERIMENTAL_POINTS[section.pointId!];
  const common = {
    id: section.id,
    title: section.title,
    status: STATUS[point.status],
    explanation: point.explanation,
    followsFromBlockIds: point.status === 'inherited' ? [EXPERIMENTAL_POINTS['lost-point'].id] : [],
  };

  if (section.kind === 'intervals') {
    return {
      ...common,
      kind: 'number_line',
      axis: {
        label: EXPERIMENTAL_COPY.solution.axisLabel,
        min: -14,
        max: 15,
        points: [
          { id: 'minus-nine', value: -9, label: '-9', included: false, sign: null },
          { id: 'three', value: 3, label: '3', included: true, sign: '0' },
          { id: 'nine', value: 9, label: '9', included: false, sign: null },
        ],
        intervals: [
          { id: 'left', from: null, to: -9, sign: '+', selected: false },
          { id: 'middle-left', from: -9, to: 3, sign: '-', selected: false },
          { id: 'middle-right', from: 3, to: 9, sign: '-', selected: false },
          { id: 'right', from: 9, to: null, sign: '+', selected: true },
        ],
        selectedPoints: ['three'],
        domain: { from: 0, to: null },
      },
    };
  }

  return {
    ...common,
    kind: 'math',
    formulas: [...section.formulas],
    ...(section.layout ? { layout: section.layout } : {}),
    ...(section.width ? { width: section.width } : {}),
  };
});

export const EXPERT_MOCK_TASKS: ExpertTask[] = [
  {
    id: EXPERIMENTAL.taskId,
    number: EXPERIMENTAL.taskNumber,
    title: EXPERIMENTAL_SOLUTION[0].title,
    statement: EXPERIMENTAL_MATH.task,
    sourceImage: EXPERIMENTAL.sourceImage,
    blocks: inequalityBlocks,
    analysis: {
      score: EXPERIMENTAL.score,
      maxScore: EXPERIMENTAL.maxScore,
      verdict: EXPERIMENTAL_COPY.verdict,
      findings: [
        {
          id: 'lost-point',
          blockId: 'lost-point',
          title: EXPERIMENTAL_WORKSPACE_COPY.findingTitle,
          description: EXPERIMENTAL_WORKSPACE_COPY.findingDescription,
          deduction: 1,
        },
      ],
      advice: EXPERIMENTAL_COPY.advice,
      criterion: EXPERIMENTAL_POINTS['lost-point'].detail!,
      correctAnswer: EXPERIMENTAL_MATH.correctAnswer,
    },
    approved: false,
    updatedByExpert: false,
    revision: EXPERT.initialRevision,
  },
  {
    id: 'trigonometry-13-1',
    number: 13,
    title: 'Реши тригонометрическое уравнение',
    statement: '\\sin x=\\frac12',
    sourceImage: null,
    blocks: [
      {
        id: 'sine-roots',
        kind: 'math',
        title: 'Корни уравнения',
        status: 'correct',
        explanation: 'Учтены оба семейства решений',
        formulas: [
          'x=\\frac{\\pi}{6}+2\\pi n',
          'x=\\frac{5\\pi}{6}+2\\pi n,\\quad n\\in\\mathbb{Z}',
        ],
        layout: 'columns',
      },
      {
        id: 'circle',
        kind: 'unit_circle',
        title: 'Тригонометрическая окружность',
        status: 'correct',
        explanation: 'Две точки на окружности имеют ординату 1/2',
        circle: {
          points: [
            { id: 'pi-six', angle: Math.PI / 6, label: 'π/6', selected: true },
            { id: 'five-pi-six', angle: (5 * Math.PI) / 6, label: '5π/6', selected: true },
          ],
          arcs: [],
        },
      },
      {
        id: 'sine-note',
        kind: 'text',
        title: 'Запись ответа',
        status: 'warning',
        text: 'В ответе записаны оба семейства корней',
        explanation: 'Укажи, что параметр n принимает только целые значения',
      },
    ],
    analysis: {
      score: 2,
      maxScore: 2,
      verdict: 'Оба семейства корней найдены верно',
      findings: [],
      advice: 'Рядом с общим решением всегда указывай, что n - целое число',
      criterion: '2 балла: найдены оба семейства корней и записан полный ответ',
      correctAnswer:
        'x=\\frac{\\pi}{6}+2\\pi n\\quad\\text{или}\\quad x=\\frac{5\\pi}{6}+2\\pi n,\\quad n\\in\\mathbb{Z}',
    },
    approved: false,
    updatedByExpert: false,
    revision: EXPERT.initialRevision,
  },
  {
    id: 'quadratic-15-2',
    number: 15,
    title: 'Реши неравенство',
    statement: 'x^2-5x+6\\leq0',
    sourceImage: null,
    blocks: [
      {
        id: 'factor',
        kind: 'math',
        title: 'Разложение на множители',
        status: 'correct',
        formulas: ['x^2-5x+6=(x-2)(x-3)', '(x-2)(x-3)\\leq0'],
        explanation: 'Сумма корней равна 5, произведение равно 6',
      },
      {
        id: 'quadratic-intervals',
        kind: 'number_line',
        title: 'Метод интервалов',
        status: 'correct',
        explanation: 'Между корнями произведение неположительно, оба корня включены',
        axis: {
          label: 'x',
          min: 0,
          max: 5,
          points: [
            { id: 'two', value: 2, label: '2', included: true, sign: '0' },
            { id: 'three', value: 3, label: '3', included: true, sign: '0' },
          ],
          intervals: [
            { id: 'left', from: null, to: 2, sign: '+', selected: false },
            { id: 'middle', from: 2, to: 3, sign: '-', selected: true },
            { id: 'right', from: 3, to: null, sign: '+', selected: false },
          ],
          selectedPoints: ['two', 'three'],
          domain: null,
        },
      },
      {
        id: 'quadratic-answer',
        kind: 'math',
        title: 'Ответ',
        status: 'correct',
        formulas: ['x\\in[2;3]'],
        explanation: 'Границы включены, потому что неравенство нестрогое',
      },
    ],
    analysis: {
      score: 2,
      maxScore: 2,
      verdict: 'Неравенство решено верно',
      findings: [],
      advice: 'Продолжай отмечать на прямой включённые границы - это помогает проверить ответ',
      criterion: '2 балла: верно найдены корни, определён знак и записан ответ',
      correctAnswer: 'x\\in[2;3]',
    },
    approved: false,
    updatedByExpert: false,
    revision: EXPERT.initialRevision,
  },
];

export const EXPERT_MOCK = {
  initialStudents: EXPERIMENTAL_STUDENTS,
  additionalTaskCount: 2,
  additionalSubmittedAt: 'Только что',
  additionalSubmittedAgoMinutes: 0,
} as const;
