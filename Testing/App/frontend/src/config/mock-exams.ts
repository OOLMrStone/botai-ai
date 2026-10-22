import { layout } from '@/config/layout';
import type { TaskBlock, TrainingTask } from '@/config/tasks';

export type MockExamSort = 'newest' | 'oldest' | 'score';
export type MockExamFilter = 'all' | 'solved' | 'unsolved';
export type MockExamResponseType = 'answer' | 'attachment';
export interface MockExamTaskRef {
  taskId: string;
  responseType: MockExamResponseType;
}
export interface MockExam {
  id: string;
  title: string;
  date: string;
  dateLabel: string;
  tasks: MockExamTaskRef[];
  provenance: { kind: 'official' | 'original'; author?: string; source?: string };
}

const PROVENANCE: TrainingTask['provenance'] = { kind: 'official', author: 'ФИПИ' };
const text = (value: string): TaskBlock => ({ type: 'text', value });
const latex = (value: string): TaskBlock => ({ type: 'latex', value });
const image = (src: string, alt: string, aspectRatio: number): TaskBlock => ({
  type: 'image',
  src,
  alt,
  aspectRatio,
  colorMode: 'monochrome',
});
const task = (
  number: number,
  content: TaskBlock[],
  acceptedAnswers: string[] = [],
): TrainingTask => ({
  id: `demo-2025-${String(number).padStart(2, '0')}`,
  examPart: number <= 12 ? 1 : 2,
  examNumber: number,
  topicIds: [],
  difficulty: number <= 12 ? 3 : 4,
  isGrob: false,
  content,
  acceptedAnswers,
  solution: [],
  provenance: PROVENANCE,
});

export const MOCK_EXAM_TASKS: TrainingTask[] = [
  task(
    1,
    [
      text(
        'Четырёхугольник ABCD вписан в окружность. Угол ABC равен 103°, угол CAD равен 42°. Найдите угол ABD. Ответ дайте в градусах',
      ),
      image('/tasks/mock-exam/task-01-diagram.svg', 'Четырёхугольник ABCD в окружности', 480 / 420),
    ],
    ['61'],
  ),
  task(
    2,
    [
      text('На координатной плоскости изображены векторы a и b. Найдите их скалярное произведение'),
      image(
        '/tasks/mock-exam/task-02-vectors.svg',
        'Векторы a и b на координатной плоскости',
        480 / 390,
      ),
    ],
    ['12'],
  ),
  task(
    3,
    [
      text(
        'Одна цилиндрическая кружка вдвое выше второй, зато вторая в полтора раза шире. Найдите отношение объёма второй кружки к объёму первой',
      ),
      image('/tasks/mock-exam/task-03-cylinders.svg', 'Две цилиндрические кружки', 480 / 320),
    ],
    ['1,125', '1.125'],
  ),
  task(
    4,
    [
      text(
        'В группе туристов 20 человек. С помощью жребия они выбирают семь человек, которые должны идти в село в магазин за продуктами. Какова вероятность того, что турист Д., входящий в состав группы, пойдёт в магазин?',
      ),
    ],
    ['0,35', '0.35'],
  ),
  task(
    5,
    [
      text(
        'Помещение освещается тремя лампами. Вероятность перегорания каждой лампы в течение года равна 0,2. Лампы перегорают независимо друг от друга. Найдите вероятность того, что в течение года хотя бы одна лампа не перегорит',
      ),
    ],
    ['0,992', '0.992'],
  ),
  task(6, [text('Найдите корень уравнения'), latex('4^{x-7}=\\frac{1}{64}')], ['4']),
  task(
    7,
    [text('Найдите значение выражения'), latex('3\\cos 2\\alpha,\\quad \\sin\\alpha=0{,}2')],
    ['2,76', '2.76'],
  ),
  task(
    8,
    [
      text(
        "На рисунке изображён график y = f'(x) производной функции f(x). На оси абсцисс отмечено десять точек: x₁, x₂, x₃, x₄, x₅, x₆, x₇, x₈, x₉, x₁₀. Сколько из этих точек принадлежит промежуткам возрастания функции f(x)?",
      ),
      image(
        '/tasks/mock-exam/task-08-graph.png',
        'График производной функции с отмеченными точками',
        2.28,
      ),
    ],
    ['6'],
  ),
  task(
    9,
    [
      text(
        'Перед отправкой тепловоз издал гудок с частотой f₀ = 295 Гц. Частота гудка подъезжающего тепловоза f зависит от его скорости v',
      ),
      latex('f(v)=\\frac{f_0}{1-\\frac{v}{c}}'),
      text(
        'Человек различает сигналы, если они отличаются не менее чем на 5 Гц. Определите минимальную скорость приближения тепловоза, если c = 300 м/с. Ответ дайте в м/с',
      ),
    ],
    ['5'],
  ),
  task(
    10,
    [
      text(
        'Моторная лодка прошла против течения реки 143 км и вернулась в пункт отправления, затратив на обратный путь на 2 часа меньше. Найдите скорость лодки в неподвижной воде, если скорость течения равна 1 км/ч. Ответ дайте в км/ч',
      ),
    ],
    ['12'],
  ),
  task(
    11,
    [
      text('На рисунке изображены графики функций'),
      latex('f(x)=ax^2+bx+c\\quad\\text{и}\\quad g(x)=kx'),
      text('Они пересекаются в точках A и B. Найдите абсциссу точки B'),
      image('/tasks/mock-exam/task-11-graph.png', 'Графики параболы и прямой', 0.84),
    ],
    ['7'],
  ),
  task(
    12,
    [
      text('Найдите наименьшее значение функции'),
      latex('y=9x-9\\ln(x+11)+7'),
      text('на отрезке [-10,5; 0]'),
    ],
    ['-83'],
  ),
  task(13, [
    text('а) Решите уравнение'),
    latex('2\\sin^3 x=\\sqrt{2}\\cos^2 x+2\\sin x'),
    text('б) Укажите корни этого уравнения, принадлежащие отрезку'),
    latex('\\left[-4\\pi;-\\frac{5\\pi}{2}\\right]'),
  ]),
  task(14, [
    text(
      'В правильном тетраэдре ABCD точки M и N - середины рёбер AB и CD соответственно. Плоскость α перпендикулярна прямой MN и пересекает ребро BC в точке K',
    ),
    text('а) Докажите, что прямая MN перпендикулярна рёбрам AB и CD'),
    text('б) Найдите площадь сечения тетраэдра ABCD плоскостью α, если BK = 1, KC = 3'),
  ]),
  task(15, [
    text('Решите неравенство'),
    latex('\\frac{\\log_2(2-x)-\\log_2(x+1)}{\\log_2^2(x^2)+\\log_2(x^4)+1}\\geq 0'),
  ]),
  task(16, [
    text(
      'В июле 2026 года планируется взять кредит на десять лет в размере 800 тыс. рублей. Условия возврата:',
    ),
    text(
      'каждый январь долг возрастает на r% по сравнению с концом предыдущего года, где r - целое число; с февраля по июнь каждого года необходимо оплатить одним платежом часть долга',
    ),
    text(
      'в июле 2027-2031 годов долг должен уменьшаться на одну и ту же величину; в июле 2031 года долг должен составить 200 тыс. рублей',
    ),
    text(
      'в июле 2032-2036 годов долг должен уменьшаться на другую одну и ту же величину; к июлю 2036 года долг должен быть выплачен полностью',
    ),
    text('Сумма всех платежей равна 1480 тыс. рублей. Найдите r'),
  ]),
  task(17, [
    text('Пятиугольник ABCDE вписан в окружность. Известно, что AB = CD = 3, BC = DE = 4'),
    text('а) Докажите, что AC = CE'),
    text('б) Найдите длину диагонали BE, если AD = 6'),
  ]),
  task(18, [
    text('Найдите все значения a, при каждом из которых система уравнений'),
    latex('\\begin{cases}(x^2-5x-y+3)\\sqrt{x-y+3}=0,\\\\y=3x+a\\end{cases}'),
    text('имеет ровно два различных решения'),
  ]),
  task(19, [
    text('Из пары натуральных чисел (a; b), где a > b, за один ход получают пару (a + b; a - b)'),
    text(
      'а) Можно ли за несколько таких ходов получить из пары (100; 1) пару, большее число в которой равно 400?',
    ),
    text('б) Можно ли за несколько таких ходов получить из пары (100; 1) пару (806; 788)?'),
    text(
      'в) Какое наименьшее a может быть в паре (a; b), из которой за несколько ходов можно получить пару (806; 788)?',
    ),
  ]),
];

const REFS: MockExamTaskRef[] = MOCK_EXAM_TASKS.map((item) => ({
  taskId: item.id,
  responseType: item.examPart === 1 ? 'answer' : 'attachment',
}));
const SOURCE = 'Демонстрационный вариант ЕГЭ 2025, профильная математика';
export const MOCK_EXAMS: MockExam[] = [
  ['variant-04', 'Пробник №4', '2026-08-18', '18 августа 2026'],
  ['variant-03', 'Пробник №3', '2026-08-11', '11 августа 2026'],
  ['variant-02', 'Пробник №2', '2026-08-04', '4 августа 2026'],
  ['variant-01', 'Пробник №1', '2026-07-28', '28 июля 2026'],
].map(([id, title, date, dateLabel]) => ({
  id,
  title,
  date,
  dateLabel,
  tasks: REFS,
  provenance: { kind: 'official', author: 'ФИПИ', source: SOURCE },
}));

export const MOCK_EXAM_COPY = {
  title: 'Пробники',
  sortLabel: 'Сортировка пробников',
  sortOptions: [
    { id: 'newest', label: 'Сначала новые' },
    { id: 'oldest', label: 'Сначала старые' },
    { id: 'score', label: 'Сначала решённые' },
  ],
  filterLabel: 'Фильтр пробников',
  filter: 'Фильтр',
  filterOptions: [
    { id: 'all', label: 'Все' },
    { id: 'solved', label: 'Только решённые' },
    { id: 'unsolved', label: 'Только нерешённые' },
  ],
  emptyFilter: 'Здесь пока нет пробников',
  solved: 'Решён',
  notStarted: 'Не начат',
  inProgress: 'В процессе',
  score: (score: number) => `${score} баллов`,
  scorePending: 'Баллов ещё нет',
  taskCount: (count: number) => `Заданий: ${count}`,
  solve: 'Решать',
  opening: 'Открываем...',
  continue: 'Продолжить',
  details: 'Открыть пробник',
  view: 'Посмотреть ответы',
  newAttempt: 'Начать заново',
  previousAttempts: 'Предыдущие попытки останутся в истории',
  detailsClose: 'Закрыть',
  detailsDate: 'Дата пробника',
  detailsResult: 'Результат',
  detailsTasks: 'Заданий в варианте',
  exit: 'Сохранить и выйти',
  attach: 'Прикрепить',
  attachments: 'Прикреплённые файлы',
  removeAttachment: (name: string) => `Открепить ${name}`,
  check: 'Проверить',
  complete: 'Проверить',
  toCheck: 'К проверке',
  task: 'Задание',
  missingTask: 'Не получилось открыть задание',
  previous: 'Предыдущее задание',
  next: 'Следующее задание',
  answer: 'Введи ответ',
} as const;
export const MOCK_EXAM_CATALOG_PATH = '/mock-exams';
export const MOCK_EXAM_SORT_ID = 'mock-exam-sort';
export const MOCK_EXAM_FILE_ACCEPT = 'image/*,.pdf';
export const MOCK_EXAM_LAYOUT = {
  page: 'w-full gap-5',
  toolbar: 'relative z-30 grid grid-cols-[minmax(0,1fr)_4rem] gap-2',
  sort: 'border-border bg-background h-11 w-full min-w-0 rounded-control border px-3 text-sm font-medium sm:w-auto',
  sortRoot: 'relative min-w-0',
  sortTrigger:
    'border-border bg-background flex h-12 w-full items-center justify-between rounded-control border px-4 text-left text-base font-medium transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
  sortChevron:
    'size-4 shrink-0 transition-transform duration-[var(--task-control-motion-duration)] motion-reduce:transition-none',
  sortChevronOpen: 'rotate-180',
  sortMenu:
    'border-border bg-popover absolute inset-x-0 top-full z-40 mt-2 max-h-[min(16rem,50svh)] overflow-y-auto rounded-card border p-1.5 shadow-lg animate-in fade-in slide-in-from-top-1 duration-[var(--task-control-motion-duration)] motion-reduce:animate-none',
  sortOption:
    'flex min-h-11 w-full items-center gap-3 rounded-[calc(var(--radius-card)-0.375rem)] px-3 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:bg-muted',
  sortCheck: 'size-4 shrink-0',
  sortCheckPlaceholder: 'size-4 shrink-0',
  filterTrigger:
    'border-border bg-background relative flex h-12 w-16 items-center justify-center gap-1.5 rounded-control border transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
  filterIcon: 'size-[1.125rem] shrink-0',
  filterIndicator:
    'absolute top-0 right-0 size-2.5 rounded-full bg-attention ring-2 ring-background',
  filterMenu: 'right-0 left-auto w-60',
  listFrame: '-mx-6 flex min-h-0 flex-1 flex-col border-t border-border',
  list: 'space-y-3 px-6 pt-4 desktop:grid desktop:grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] desktop:content-start desktop:gap-4 desktop:space-y-0 landscape-short:grid landscape-short:grid-cols-2 landscape-short:content-start landscape-short:gap-3 landscape-short:space-y-0',
  card: 'border-border bg-card group flex min-h-40 w-full min-w-0 flex-col rounded-card border p-5 text-left shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_6%,transparent)] outline-none transition-[background-color,border-color,transform] duration-[var(--task-control-motion-duration)] hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-ring/40 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0',
  cardMeta:
    'flex min-h-5 items-start justify-between gap-3 text-sm leading-5 text-muted-foreground',
  cardStatus: 'shrink-0 text-right',
  cardBody: 'mt-4 flex min-h-0 flex-1 min-w-0 items-end justify-between gap-4',
  cardTitle: 'min-w-0 text-xl font-semibold',
  cardResult: 'mt-1 text-base font-medium tabular-nums',
  cardHint: 'text-muted-foreground mt-1 text-sm',
  emptyFilter:
    'text-muted-foreground flex min-h-32 items-center justify-center text-center text-sm',
  cardChevron:
    'text-muted-foreground size-5 shrink-0 transition-transform duration-[var(--task-control-motion-duration)] group-hover:translate-x-0.5 motion-reduce:transition-none',
  cardAction: 'mt-auto h-11 w-full text-base',
  details: 'space-y-5',
  detailsGrid: 'grid grid-cols-2 gap-3',
  detailsMetric: 'bg-muted/55 rounded-card p-4',
  detailsTaskMetric: 'col-span-2',
  detailsLabel: 'text-sm text-muted-foreground',
  detailsValue: 'mt-1 text-lg font-semibold tabular-nums',
  detailsAction: 'h-12 w-full text-base',
  detailsActions: 'flex flex-col gap-3',
  attachmentStrip: 'flex min-w-0 shrink-0 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1',
  attachment:
    'border-border bg-muted/60 flex h-11 max-w-64 shrink-0 items-center overflow-hidden rounded-full border pl-4 text-sm',
  attachmentName: 'min-w-0 truncate',
  attachmentRemove:
    'hover:bg-muted focus-visible:ring-ring/50 ml-1 flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 motion-reduce:transition-none',
  attachmentRemoveIcon: 'size-4',
  footerAction: layout.training.reviewButton,
  visuallyHidden: 'sr-only',
} as const;
export function mockExamPath(mockExamId: string) {
  return `/mock-training/${mockExamId}`;
}
