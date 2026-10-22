import { personalLayoutWork } from '@/lib/api/personal-layout-fixture';
import { IS_MOCK_API } from '@/config/env';
import {
  EXPERT,
  EXPERT_COPY,
  EXPERT_API_ERRORS,
  type ExpertSession,
  type ExpertTask,
  type ExpertWork,
  type ExpertWorkspaceData,
} from '@/config/expert';
import { fetchCurrentUser, loginUser, logoutUser, type User } from '@/lib/api/auth';
import { ApiError, apiFetch } from '@/lib/api/client';
import {
  approveExpertDemoWork,
  assignExpertDemoStudent,
  demoExpertSession,
  enterExpertDemo,
  fetchExpertDemo,
  gradeExpertDemoTask,
  leaveExpertDemo,
  saveExpertDemoTask,
} from '@/lib/api/expert-mock';
import type {
  ExpertIdentityDto,
  ExpertCanonicalDocument,
  ExpertPageDto,
  ExpertStudentDto,
  ExpertWorkDto,
} from '@/lib/api/expert-types';
import {
  expertInitials,
  sameExpertData,
  validateExpertApproval,
  validateExpertTask,
} from '@/lib/expert';
import {
  expertStudentFromDto,
  expertTaskToCanonical,
  expertWorkFromDto,
} from '@/lib/expert-adapter';

async function expertSession(user: User): Promise<ExpertSession> {
  if (!EXPERT.roles.some((role) => role === user.role))
    throw new ApiError(403, EXPERT_COPY.errors.role);
  const identity = await apiFetch<ExpertIdentityDto>(EXPERT.endpoints.me);
  const name = identity.displayName || identity.email;

  return {
    id: identity.id,
    name,
    email: identity.email,
    initials: expertInitials(name),
    mode: 'live',
  };
}

async function allExpertPages<T>(endpoint: string): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ limit: String(EXPERT.pageLimit) });
    if (cursor !== null) query.set('cursor', cursor);
    const page: ExpertPageDto<T> = await apiFetch(`${endpoint}?${query}`);
    if (!Array.isArray(page.items)) throw new ApiError(502, EXPERT_COPY.errors.invalidData);
    items.push(...page.items);
    cursor = page.nextCursor ?? null;
    if (cursor !== null && (typeof cursor !== 'string' || cursors.has(cursor)))
      throw new ApiError(502, EXPERT_COPY.errors.invalidData);
    if (cursor !== null) cursors.add(cursor);
  } while (cursor !== null);

  return items;
}

export async function fetchExpertSession(): Promise<ExpertSession | null> {
  if (IS_MOCK_API) return demoExpertSession();
  const user = await fetchCurrentUser();

  return user ? expertSession(user) : null;
}

export async function loginExpert(email: string, password: string): Promise<ExpertSession> {
  if (IS_MOCK_API) throw new ApiError(503, EXPERT_COPY.errors.localLogin);
  const user = await loginUser({ email: email.trim(), password });

  return expertSession(user);
}

export const startExpertDemo = enterExpertDemo;

export async function logoutExpert(session: ExpertSession): Promise<void> {
  if (session.mode === 'demo') await leaveExpertDemo();
  else await logoutUser();
}

export async function fetchExpertWorkspace(session: ExpertSession): Promise<ExpertWorkspaceData> {
  if (session.mode === 'demo') return fetchExpertDemo();
  const [students, summaries] = await Promise.all([
    allExpertPages<ExpertStudentDto>(EXPERT.endpoints.students),
    allExpertPages<{ id: string }>(EXPERT.endpoints.works),
  ]);
  const works = await Promise.all(
    summaries.map(async (summary) => {
      try {
        return await apiFetch<ExpertWorkDto>(
          `${EXPERT.endpoints.works}/${encodeURIComponent(summary.id)}`,
        );
      } catch (cause) {
        // Назначение может быть отозвано между чтением списка и конкретной работы.
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      }
    }),
  );

  return {
    students: students.map(expertStudentFromDto),
    works: await Promise.all(works.filter((work) => work !== null).map(personalLayoutWork)),
  };
}

export async function addExpertStudent(
  session: ExpertSession,
  id: string,
): Promise<ExpertWorkspaceData> {
  if (!id.trim()) throw new ApiError(422, EXPERT_COPY.errors.studentId);
  if (session.mode === 'demo') return assignExpertDemoStudent(id);
  await apiFetch(EXPERT.endpoints.students, { json: { studentId: id.trim() } });

  return fetchExpertWorkspace(session);
}

export class ExpertPartialSaveError extends Error {
  constructor(
    public readonly savedWork: ExpertWork,
    public readonly failure: unknown,
  ) {
    super(EXPERT_COPY.errors.partialSend);
    this.name = 'ExpertPartialSaveError';
  }
}

function interruptedExpertWrite(cause: unknown) {
  return (
    cause instanceof TypeError ||
    cause instanceof DOMException ||
    (cause instanceof ApiError && (cause.status >= 500 || cause.status === 409))
  );
}

async function writeExpertDocument(
  workId: string,
  action: 'draft' | 'send' | 'manualGrade',
  revision: number,
  document: ExpertCanonicalDocument,
): Promise<ExpertWorkDto> {
  const workEndpoint = `${EXPERT.endpoints.works}/${encodeURIComponent(workId)}`;

  try {
    return await apiFetch<ExpertWorkDto>(`${workEndpoint}/${EXPERT.workActions[action]}`, {
      method: action === 'draft' ? 'PUT' : 'POST',
      json: { expectedRevision: revision, document },
    });
  } catch (cause) {
    if (!interruptedExpertWrite(cause)) throw cause;
    const recovered = await apiFetch<ExpertWorkDto>(workEndpoint).catch(() => null);
    const status = action === 'send' ? 'sent' : 'draft';
    if (
      !recovered ||
      recovered.revision !== revision + 1 ||
      recovered.status !== status ||
      (action === 'manualGrade' && recovered.gradingStale !== false) ||
      !sameExpertData(recovered.review, document)
    )
      throw cause;

    return recovered;
  }
}

export async function saveExpertTask(
  session: ExpertSession,
  workId: string,
  task: ExpertTask,
  approve: boolean,
): Promise<ExpertWork> {
  const error = approve ? validateExpertApproval(task) : validateExpertTask(task);
  if (error) throw new ApiError(422, error);
  if (task.readOnly) throw new ApiError(409, EXPERT_COPY.errors.readOnly);
  if (session.mode === 'demo') return saveExpertDemoTask(workId, task, approve);
  let document = expertTaskToCanonical(task);
  let revision = task.revision;
  let manual: ExpertWorkDto | null = null;
  if (task.manualGradePending) {
    manual = await writeExpertDocument(workId, 'manualGrade', revision, document);
    if (!approve) return expertWorkFromDto(manual);
    document = manual.review;
    revision = manual.revision;
  }
  let saved: ExpertWorkDto;
  try {
    saved = await writeExpertDocument(workId, approve ? 'send' : 'draft', revision, document);
  } catch (cause) {
    if (manual) throw new ExpertPartialSaveError(expertWorkFromDto(manual), cause);
    throw cause;
  }

  const result = expertWorkFromDto(saved);
  if (saved.gradingStale === undefined && task.analysis.gradeStale)
    result.tasks[0].analysis.gradeStale = true;

  return result;
}

export async function approveExpertWork(
  session: ExpertSession,
  work: ExpertWork,
): Promise<ExpertWork> {
  const error = work.tasks.map(validateExpertApproval).find(Boolean);
  if (error) throw new ApiError(422, error);
  if (session.mode === 'demo') return approveExpertDemoWork(work);
  if (work.tasks.length !== 1) throw new ApiError(422, EXPERT_COPY.errors.invalidData);

  return saveExpertTask(session, work.id, work.tasks[0], true);
}

const gradeCommands = new Map<string, { payload: string; key: string }>();

export async function gradeExpertTask(
  session: ExpertSession,
  workId: string,
  task: ExpertTask,
): Promise<ExpertWork> {
  const error = validateExpertTask(task);
  if (error) throw new ApiError(422, error);
  if (task.readOnly) throw new ApiError(409, EXPERT_COPY.errors.readOnly);
  if (session.mode === 'demo') return gradeExpertDemoTask(workId, task);
  const document = expertTaskToCanonical(task);
  const endpoint = `${EXPERT.endpoints.works}/${encodeURIComponent(workId)}/${EXPERT.workActions.grade}`;
  const json = { expectedRevision: task.revision, document };
  const payload = JSON.stringify(json);
  const commandId = `${session.id}:${workId}`;
  const previous = gradeCommands.get(commandId);
  const key = previous?.payload === payload ? previous.key : crypto.randomUUID();
  gradeCommands.set(commandId, { payload, key });
  let saved: ExpertWorkDto;
  try {
    saved = await apiFetch<ExpertWorkDto>(endpoint, {
      method: 'POST',
      headers: { [EXPERT.idempotencyHeader]: key },
      json,
    });
  } catch (cause) {
    const interrupted =
      cause instanceof TypeError ||
      cause instanceof DOMException ||
      (cause instanceof ApiError && cause.status >= 500);
    if (!interrupted) throw cause;
    const recovered = await apiFetch<ExpertWorkDto>(
      `${EXPERT.endpoints.works}/${encodeURIComponent(workId)}`,
    ).catch(() => null);
    if (!recovered?.gradeJob || recovered.gradeJob.baseRevision !== task.revision) throw cause;
    saved = recovered;
  }
  if (
    !sameExpertData(saved.review.ocr, document.ocr) ||
    !sameExpertData(saved.review.analysis, document.analysis)
  ) {
    throw new ApiError(502, EXPERT_COPY.errors.gradingChangedContent);
  }

  return expertWorkFromDto(saved);
}

export async function fetchExpertGradeJob(
  session: ExpertSession,
  workId: string,
  jobId: string,
): Promise<ExpertWork> {
  if (session.mode !== 'live') throw new ApiError(422, EXPERT_COPY.errors.invalidData);
  const endpoint = `${EXPERT.endpoints.works}/${encodeURIComponent(workId)}/${EXPERT.workActions.gradeJobs}/${encodeURIComponent(jobId)}`;

  return expertWorkFromDto(await apiFetch<ExpertWorkDto>(endpoint));
}

export function expertErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code && Object.hasOwn(EXPERT_API_ERRORS, cause.code))
    return EXPERT_API_ERRORS[cause.code];
  if (
    cause instanceof Error &&
    Object.values(EXPERT_COPY.errors).some((message) => message === cause.message)
  )
    return cause.message;
  if (cause instanceof ApiError && cause.status === 401) return EXPERT_COPY.errors.session;
  if (cause instanceof ApiError && cause.status === 403) return EXPERT_COPY.errors.role;

  return EXPERT_COPY.errors.request;
}
