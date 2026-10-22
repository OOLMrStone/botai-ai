import type { PipelineFailure } from '@/lib/api/pipeline-console-types';
import { EXPERT_FINDING_REVIEW } from '@/config/expert-causality';
import { EXPERIMENTAL_QUEUE, EXPERIMENTAL_WORKSPACE_COPY } from '@/config/experimental-workspace';
import type { TaskBlock } from '@/config/tasks';

export type ExpertBlockStatus = 'correct' | 'error' | 'warning' | 'follow_through' | null;
export type ExpertQueueSort = 'oldest' | 'newest';
export type ExpertQueueFilter = 'pending' | 'reviewed';
export type ExpertView = 'queue' | 'students' | 'review';

export interface ExpertSession {
  id: string;
  name: string;
  email: string;
  initials: string;
  mode: 'demo' | 'live';
}

export interface ExpertStudent {
  id: string;
  name: string;
  initials: string;
  email: string;
  contact: string;
}

export interface ExpertBlockBase {
  id: string;
  title: string;
  status: ExpertBlockStatus;
  explanation: string;
  followsFromBlockIds?: string[];
}

export interface ExpertTextBlock extends ExpertBlockBase {
  kind: 'text';
  text: string;
}

export interface ExpertMathBlock extends ExpertBlockBase {
  kind: 'math';
  formulas: string[];
  layout?: 'columns';
  width?: 'half';
}

export interface ExpertStepBlock extends ExpertBlockBase {
  kind: 'step';
  lines: string[];
  image?: { id: string; alt: string; url: string | null; width?: number; height?: number };
  diagram?: ExpertDiagram;
}

export interface ExpertNumberLinePoint {
  id: string;
  value: number;
  label: string;
  included: boolean;
  marker?: 'open' | 'closed' | null;
  sign: '+' | '-' | '0' | null;
}

export interface ExpertNumberLineInterval {
  id: string;
  from: number | null;
  to: number | null;
  sign: '+' | '-' | '0' | null;
  selected: boolean;
}

export interface ExpertNumberLine {
  label: string;
  min: number;
  max: number;
  points: ExpertNumberLinePoint[];
  intervals: ExpertNumberLineInterval[];
  selectedPoints: string[];
  domain: { from: number | null; to: number | null } | null;
}

export interface ExpertNumberLineBlock extends ExpertBlockBase {
  kind: 'number_line';
  axis: ExpertNumberLine;
}

export interface ExpertUnitCircle {
  points: {
    id: string;
    angle: number;
    label: string;
    selected: boolean;
    marker?: 'open' | 'closed' | null;
  }[];
  arcs: {
    id: string;
    from: number;
    to: number;
    fromPointId?: string;
    toPointId?: string;
    fullCircle?: boolean;
    direction: 'ccw' | 'cw';
    selected: boolean;
  }[];
}

export interface ExpertUnitCircleBlock extends ExpertBlockBase {
  kind: 'unit_circle';
  circle: ExpertUnitCircle;
}

export type ExpertNumericDiagram =
  | { kind: 'number_line'; axis: ExpertNumberLine }
  | { kind: 'unit_circle'; circle: ExpertUnitCircle };

export interface ExpertNativePoint {
  id: string;
  value: string;
  included: boolean | null;
  sign: '+' | '-' | '0' | null;
  bound?: boolean;
}

export interface ExpertNativeArc {
  from: string;
  to: string;
  sign: '+' | '-' | '0' | null;
  selected: boolean;
}

export interface ExpertNativeCircleArc extends ExpertNativeArc {
  direction: 'cw' | 'ccw';
  full_circle: boolean;
}

export interface ExpertNativeNumberLine {
  kind: 'number_line_v2';
  variable: string;
  note: string | null;
  points: ExpertNativePoint[];
  arcs: ExpertNativeArc[];
}

export interface ExpertNativeUnitCircle {
  kind: 'unit_circle_v2';
  points: ExpertNativePoint[];
  arcs: ExpertNativeCircleArc[];
}

export type ExpertNativeDiagram = ExpertNativeNumberLine | ExpertNativeUnitCircle;
export type ExpertDiagram = ExpertNumericDiagram | ExpertNativeDiagram;

export type ExpertBlock =
  | ExpertTextBlock
  | ExpertMathBlock
  | ExpertStepBlock
  | ExpertNumberLineBlock
  | ExpertUnitCircleBlock;

export interface ExpertFinding {
  kind?: 'error' | 'warning';
  id: string;
  blockId: string;
  title: string;
  description: string;
  deduction?: number;
}

export interface ExpertAnalysis {
  score: number;
  maxScore: number;
  verdict: string;
  findings: ExpertFinding[];
  advice: string;
  criterion: string;
  correctAnswer: string;
  rejectedReason?: string;
  summary?: string;
  hasGrade?: boolean;
  gradeStale?: boolean;
}

export interface ExpertTask {
  id: string;
  number: number;
  title: string;
  statement: string;
  statementContent?: TaskBlock[];
  sourceImage: string | null;
  blocks: ExpertBlock[];
  analysis: ExpertAnalysis;
  approved: boolean;
  updatedByExpert: boolean;
  revision: number;
  readOnly?: boolean;
  manualGradePending?: boolean;
  gradingJob?: {
    id: string;
    state: 'queued' | 'pending' | 'succeeded' | 'failed' | 'unknown' | 'stale';
    errorCode?: string | null;
    failure?: PipelineFailure | null;
  };
  sourceImages?: {
    id: string;
    url: string;
    name: string;
    mimeType?: string;
    sourceDocumentId?: string | null;
    pageNumber?: number | null;
    originalDocument?: { id: string; name: string; mimeType: string; downloadUrl: string };
  }[];
  backend?: { document: unknown; phase: string; workId: string };
}

export interface ExpertWork {
  id: string;
  studentId: string;
  student: ExpertStudent;
  subject: string;
  submittedAt: string;
  submittedAgoMinutes: number;
  status: ExpertQueueFilter;
  tasks: ExpertTask[];
}

export interface ExpertWorkspaceData {
  students: ExpertStudent[];
  works: ExpertWork[];
}

export const EXPERT = {
  storageKey: 'botai-expert-demo-v1',
  sessionKey: 'botai-expert-demo-session-v1',
  storageVersion: 1,
  demoSession: {
    id: 'demo-expert',
    name: 'Эксперт',
    email: 'expert@botai.demo',
    initials: EXPERIMENTAL_WORKSPACE_COPY.expertInitials,
    mode: 'demo',
  } satisfies ExpertSession,
  sortOptions: EXPERIMENTAL_QUEUE.sortOptions,
  minScore: 0,
  initialRevision: 1,
  pageLimit: 50,
  diagramPadding: 2,
  minutesInMillisecond: 60_000,
  radiansInTurn: Math.PI * 2,
  schemaVersions: ['expert-review.v1', 'expert-review.v2'],
  structuredStep: { maxLines: 64, maxLineLength: 16_000, maxTitleLength: 500 },
  nativeDiagram: {
    maxPoints: 64,
    maxArcs: 128,
    maxIdLength: 128,
    maxValueLength: 500,
    maxNoteLength: 2_000,
    maxVariableLength: 64,
    infinityEndpoints: ['-inf', '+inf'],
    signs: ['+', '-', '0'],
  },
  workActions: {
    draft: 'draft',
    send: 'send',
    grade: 'grade',
    manualGrade: 'manual-grade',
    gradeJobs: 'grade-jobs',
  },
  demoErrorDeduction: 1,
  activeGradeStates: ['queued', 'pending'],
  gradePollMs: 2_000,
  queuePollMs: 5_000,
  idempotencyHeader: 'Idempotency-Key',
  locale: 'ru-RU',
  minutesPerHour: 60,
  minutesPerDay: 1_440,
  roles: ['EXPERT'],
  endpoints: {
    me: '/api/expert/me',
    students: '/api/expert/students',
    works: '/api/expert/works',
  },
} as const;

export const EXPERT_ARTIFACT_URL_PATTERN = /^\/api\/[a-zA-Z0-9/_-]+$/;

export const EXPERT_STATUS_OPTIONS: { value: ExpertBlockStatus; label: string }[] = [
  { value: null, label: 'Ещё не проверено' },
  { value: 'correct', label: 'Верный шаг' },
  { value: 'error', label: 'Ошибка' },
  { value: 'warning', label: 'Недочёт' },
  { value: 'follow_through', label: 'Следствие ошибки' },
];

export const EXPERT_COPY = {
  ...EXPERIMENTAL_WORKSPACE_COPY,
  loginTitle: 'Кабинет эксперта',
  loginSubtitle: 'Проверяй работы учеников вместе с ИИ',
  demo: 'Открыть демо-кабинет',
  demoHint: 'Попробуй проверку на примерах работ',
  logout: 'Выйти',
  loading: 'Загружаем кабинет',
  retry: 'Попробовать снова',
  students: 'Ученики',
  works: 'Работы',
  reviewed: 'Проверены',
  addStudent: 'Добавить ученика',
  studentId: 'ID ученика',
  studentIdHint: 'Введи ID ученика из своей школы',
  demoStudentId: 'anna-smirnova',
  demoStudentHint: 'В демо можно добавить ученика anna-smirnova',
  add: 'Добавить',
  studentAdded: 'Ученик добавлен',
  newWorkReady: 'Новая работа готова к проверке',
  graded: 'Оценка пересчитана по текущему разбору',
  gradeQueued: 'Оценка ждёт свободного места в очереди',
  gradeWaiting: 'В очереди',
  gradeConnection: 'Связь прервалась. Продолжаем ждать результат пересчёта',
  gradePending: 'Оценка пересчитывается. Разбор и распознавание остаются прежними',
  gradeUnknown: 'Уточняем результат пересчёта',
  gradeUncertain: (message: string, diagnostic: string) =>
    diagnostic ? `${message} · ${diagnostic}` : message,
  demoGradeVerdict: (errors: number) =>
    errors
      ? `Самостоятельных ошибок: ${errors}. Следствия повторно не снижают балл`
      : 'В текущем разборе нет самостоятельных ошибок',
  approvedTask: 'Результат подтверждён',
  saving: 'Сохраняем',
  editStep: 'Исправить шаг',
  blockTitle: (index: number) => `Шаг ${index + 1}`,
  taskTitle: 'Решение задачи',
  generalFinding: 'Замечание к решению',
  findingNeedsReview: 'Связь с шагом требует проверки',
  findingsReviewFooter: EXPERT_FINDING_REVIEW.footer,
  noSource: 'Фото для этой задачи не добавлено',
  noPending: 'Все работы проверены',
  noPendingHint: 'Новые решения появятся здесь',
  noReviewed: 'Проверенных работ пока нет',
  noReviewedHint: 'Подтверди первую оценку, и работа появится здесь',
  pendingTasks: (count: number) => `Ждут проверки: ${count}`,
  studentContact: 'Контакт',
  noContact: 'Не указан',
  studentEmail: 'Почта',
  taskLabel: (index: number) => `Задача ${index + 1}`,
  taskNumber: (number: number) => `№ ${number}`,
  errors: {
    unsavedSession: 'Подтверди или сбрось правки перед выходом',
    request: 'Не удалось загрузить кабинет. Попробуй ещё раз',
    save: 'Не удалось сохранить изменения. Твои правки остались здесь',
    partialSend: 'Оценка и правки сохранены, но отправка не завершена. Попробуй отправить ещё раз',
    credentials: 'Проверь почту и пароль',
    role: 'Для этого кабинета нужен доступ эксперта',
    localLogin: 'На этом стенде доступен демо-кабинет. Для входа эксперта подключи сервер',
    session: 'Войди ещё раз, чтобы продолжить проверку',
    studentMissing: 'Ученик с таким ID не найден',
    studentAssigned: 'Этот ученик уже в твоём кабинете',
    studentId: 'Введи ID ученика',
    taskMissing: 'Задача не найдена. Обнови список работ',
    conflict: 'Работа уже изменена в другом окне. Обнови кабинет перед сохранением',
    score: 'Балл должен быть целым числом в пределах максимума',
    block: 'Заполни название и содержание шага',
    geometry: 'Проверь границы, точки и промежутки',
    findings: 'Каждая ошибка должна ссылаться на существующий шаг',
    deduction: 'Штраф должен быть целым числом от 0 до максимального балла',
    deductionCause: 'За недочёт и следствие ошибки нельзя снимать баллы повторно',
    unsupportedDeduction: 'В этом разборе штрафы пока нельзя менять',
    storage: 'Не удалось сохранить демо на этом устройстве',
    gradeFailed: 'Пересчёт не завершился. Твой разбор сохранён',
    gradeStale: 'Разбор изменился во время пересчёта. Повтори пересчёт для новой версии',
    staleGrade: 'Пересчитай или обнови оценку после изменений разбора',
    missingGrade: 'Сначала выстави оценку',
    gradingChangedContent: 'Не удалось сверить оценку с текущим разбором. Обнови кабинет',
    gradingUnavailable: 'Не удалось пересчитать оценку. Твой разбор сохранён - попробуй ещё раз',
    readOnly: 'Эта работа уже отправлена ученику и доступна только для просмотра',
    followThrough: 'Для следствия ошибки укажи исходный ошибочный шаг',
    unsupportedGeometry: 'Границы дуги должны совпадать с отмеченными точками',
    invalidData: 'Не удалось открыть разбор. Попробуй обновить список работ',
  },
} as const;

export const EXPERT_API_ERRORS: Record<string, string> = {
  revision_conflict: EXPERT_COPY.errors.conflict,
  student_assigned: EXPERT_COPY.errors.studentAssigned,
  review_sent: EXPERT_COPY.errors.readOnly,
  grading_stale: EXPERT_COPY.errors.staleGrade,
  grading_in_progress: EXPERT_COPY.gradePending,
  grading_unavailable: EXPERT_COPY.errors.gradingUnavailable,
  session_required: EXPERT_COPY.errors.session,
  forbidden: EXPERT_COPY.errors.role,
};

export const EXPERT_WORK_STATUSES = {
  ready: { label: EXPERT_COPY.queueReady, tone: 'ready' },
  reviewed: { label: 'Проверено экспертом', tone: 'reviewed' },
  gradingQueued: { label: 'Оценка в очереди', tone: 'pending' },
  grading: { label: 'Пересчитывается оценка', tone: 'pending' },
  unknown: { label: 'Уточняется результат', tone: 'warning' },
  failed: { label: 'Пересчёт не завершён', tone: 'warning' },
  rejected: { label: 'Нужна проверка эксперта', tone: 'warning' },
  stale: { label: 'Оценка требует пересмотра', tone: 'warning' },
  ocr: { label: 'Ожидает разбора', tone: 'pending' },
} as const;
