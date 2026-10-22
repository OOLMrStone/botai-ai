import { TIMINGS } from '@/config/constants';
import { EXPERIMENTAL } from '@/config/experimental';
import {
  EXPERT,
  EXPERT_COPY,
  type ExpertSession,
  type ExpertStudent,
  type ExpertTask,
  type ExpertWork,
  type ExpertWorkspaceData,
} from '@/config/expert';
import { EXPERT_MOCK, EXPERT_MOCK_STUDENTS, EXPERT_MOCK_TASKS } from '@/config/expert-mock';
import { ApiError, sleep } from '@/lib/api/client';
import { replaceExpertTask, validateExpertApproval, validateExpertTask } from '@/lib/expert';

interface DemoDatabase extends ExpertWorkspaceData {
  version: number;
}

function createWork(
  student: ExpertStudent,
  count: number,
  submittedAt: string,
  submittedAgoMinutes: number,
  subject: string,
): ExpertWork {
  return {
    id: `work-${student.id}`,
    studentId: student.id,
    student,
    subject,
    submittedAt,
    submittedAgoMinutes,
    status: 'pending',
    tasks: Array.from({ length: count }, (_, index) => ({
      ...structuredClone(EXPERT_MOCK_TASKS[index % EXPERT_MOCK_TASKS.length]),
      id: `${student.id}-${index}`,
    })),
  };
}

function createDatabase(): DemoDatabase {
  const students = EXPERT_MOCK_STUDENTS.filter((student) =>
    EXPERT_MOCK.initialStudents.some((initial) => initial.id === student.id),
  );

  return {
    version: EXPERT.storageVersion,
    students: structuredClone(students),
    works: EXPERT_MOCK.initialStudents.map((initial) =>
      createWork(
        students.find((student) => student.id === initial.id)!,
        initial.tasks,
        initial.submittedAt,
        initial.submittedAgoMinutes,
        initial.subject,
      ),
    ),
  };
}

function readDatabase(): DemoDatabase {
  const saved = localStorage.getItem(EXPERT.storageKey);
  if (!saved) return createDatabase();

  try {
    const parsed: unknown = JSON.parse(saved);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      parsed.version === EXPERT.storageVersion &&
      'students' in parsed &&
      Array.isArray(parsed.students) &&
      'works' in parsed &&
      Array.isArray(parsed.works)
    ) {
      const database = parsed as DemoDatabase;

      return {
        ...database,
        works: database.works.map((work) => ({
          ...work,
          tasks: work.tasks.map((task) =>
            task.sourceImage === EXPERIMENTAL.sourceImage
              ? { ...task, number: EXPERIMENTAL.taskNumber }
              : task,
          ),
        })),
      };
    }
  } catch {
    // Несовместимый демо-снимок не должен мешать открыть новый кабинет.
  }

  return createDatabase();
}

function writeDatabase(database: DemoDatabase): void {
  try {
    localStorage.setItem(EXPERT.storageKey, JSON.stringify(database));
  } catch {
    throw new ApiError(507, EXPERT_COPY.errors.storage);
  }
}

function requireSession(): void {
  if (sessionStorage.getItem(EXPERT.sessionKey) !== EXPERT.demoSession.id)
    throw new ApiError(401, EXPERT_COPY.errors.session);
}

export function demoExpertSession(): ExpertSession | null {
  return sessionStorage.getItem(EXPERT.sessionKey) === EXPERT.demoSession.id
    ? { ...EXPERT.demoSession }
    : null;
}

export async function enterExpertDemo(): Promise<ExpertSession> {
  await sleep(TIMINGS.mockLatencyMs);
  sessionStorage.setItem(EXPERT.sessionKey, EXPERT.demoSession.id);

  return { ...EXPERT.demoSession };
}

export async function leaveExpertDemo(): Promise<void> {
  sessionStorage.removeItem(EXPERT.sessionKey);
}

export async function fetchExpertDemo(): Promise<ExpertWorkspaceData> {
  requireSession();
  await sleep(TIMINGS.mockLatencyMs);
  requireSession();

  return structuredClone(readDatabase());
}

export async function assignExpertDemoStudent(id: string): Promise<ExpertWorkspaceData> {
  requireSession();
  await sleep(TIMINGS.mockLatencyMs);
  requireSession();
  const database = readDatabase();
  const student = EXPERT_MOCK_STUDENTS.find((candidate) => candidate.id === id.trim());
  if (!student) throw new ApiError(404, EXPERT_COPY.errors.studentMissing);
  if (database.students.some((candidate) => candidate.id === student.id))
    throw new ApiError(409, EXPERT_COPY.errors.studentAssigned);

  database.students.push(structuredClone(student));
  database.works.push(
    createWork(
      student,
      EXPERT_MOCK.additionalTaskCount,
      EXPERT_MOCK.additionalSubmittedAt,
      EXPERT_MOCK.additionalSubmittedAgoMinutes,
      EXPERT_MOCK.initialStudents[0].subject,
    ),
  );
  writeDatabase(database);

  return structuredClone(database);
}

export async function saveExpertDemoTask(
  workId: string,
  task: ExpertTask,
  approve: boolean,
): Promise<ExpertWork> {
  requireSession();
  const error = approve ? validateExpertApproval(task) : validateExpertTask(task);
  if (error) throw new ApiError(422, error);
  await sleep(TIMINGS.mockLatencyMs);
  requireSession();
  const database = readDatabase();
  const work = database.works.find((candidate) => candidate.id === workId);
  const saved = work?.tasks.find((candidate) => candidate.id === task.id);
  if (!work || !saved) throw new ApiError(404, EXPERT_COPY.errors.taskMissing);
  if (saved.revision !== task.revision) throw new ApiError(409, EXPERT_COPY.errors.conflict);

  const next = replaceExpertTask(work, {
    ...structuredClone(task),
    approved: approve,
    manualGradePending: false,
    revision: saved.revision + 1,
  });
  database.works = database.works.map((candidate) => (candidate.id === workId ? next : candidate));
  writeDatabase(database);

  return structuredClone(next);
}

export async function approveExpertDemoWork(work: ExpertWork): Promise<ExpertWork> {
  requireSession();
  const error = work.tasks.map(validateExpertApproval).find(Boolean);
  if (error) throw new ApiError(422, error);
  await sleep(TIMINGS.mockLatencyMs);
  requireSession();
  const database = readDatabase();
  const saved = database.works.find((candidate) => candidate.id === work.id);
  if (!saved) throw new ApiError(404, EXPERT_COPY.errors.taskMissing);
  if (
    saved.tasks.some(
      (task) =>
        work.tasks.find((candidate) => candidate.id === task.id)?.revision !== task.revision,
    )
  ) {
    throw new ApiError(409, EXPERT_COPY.errors.conflict);
  }

  const next: ExpertWork = {
    ...structuredClone(work),
    status: 'reviewed',
    tasks: work.tasks.map((task) => ({ ...task, approved: true, revision: task.revision + 1 })),
  };
  database.works = database.works.map((candidate) => (candidate.id === work.id ? next : candidate));
  writeDatabase(database);

  return structuredClone(next);
}

export async function gradeExpertDemoTask(workId: string, task: ExpertTask): Promise<ExpertWork> {
  const errors = task.blocks.filter((block) => block.status === 'error').length;
  const analysis = {
    ...task.analysis,
    score: Math.max(EXPERT.minScore, task.analysis.maxScore - errors * EXPERT.demoErrorDeduction),
    verdict: EXPERT_COPY.demoGradeVerdict(errors),
    hasGrade: true,
    gradeStale: false,
    rejectedReason: undefined,
  };

  return saveExpertDemoTask(workId, { ...task, analysis, updatedByExpert: true }, false);
}
