import { SCHOOL, SCHOOL_COPY } from '@/config/school';
import { SCHOOL_API_ERRORS } from '@/config/school-errors';
import { AUTH_ENDPOINT } from '@/config/auth';
import { LEARNING_COPY } from '@/config/integration';
import { loginUser, logoutUser } from '@/lib/api/auth';
import { apiFetch, ApiError } from '@/lib/api/client';
import { expertDocument } from '@/lib/expert-adapter';
import type { Page } from '@/lib/api/learning-types';
import type {
  SchoolAssignment,
  SchoolAssignmentSummary,
  SchoolIdentity,
  SchoolSubmission,
} from '@/lib/api/school-types';

export function schoolSubmission(value: SchoolSubmission): SchoolSubmission {
  if (
    value.origin !== 'school' ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.documents) ||
    !Object.hasOwn(SCHOOL_COPY.statuses, value.status) ||
    (value.result !== null &&
      (value.status !== 'returned' || value.expertReview?.status !== 'sent')) ||
    (value.status === 'returned' && value.result === null)
  )
    throw new ApiError(502, SCHOOL_COPY.invalidData);

  return { ...value, result: value.result === null ? null : expertDocument(value.result) };
}

export async function fetchSchoolSession(): Promise<SchoolIdentity | null> {
  try {
    return await apiFetch<SchoolIdentity>(SCHOOL.endpoints.me);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) return null;
    throw cause;
  }
}

export async function loginSchool(email: string, password: string) {
  try {
    await loginUser({ email: email.trim(), password });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) throw new Error(SCHOOL_COPY.credentials);
    throw cause;
  }
  await apiFetch<void>(AUTH_ENDPOINT.csrf);
  return fetchSchoolSession();
}

export const logoutSchool = logoutUser;

export async function fetchSchoolAssignments(): Promise<SchoolAssignmentSummary[]> {
  const items: SchoolAssignmentSummary[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ limit: String(SCHOOL.pageLimit) });
    if (cursor) query.set('cursor', cursor);
    const page: Page<SchoolAssignmentSummary> = await apiFetch(
      `${SCHOOL.endpoints.assignments}?${query}`,
    );
    if (!Array.isArray(page.items)) throw new ApiError(502, SCHOOL_COPY.invalidData);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new ApiError(502, SCHOOL_COPY.invalidData);
    if (cursor) seen.add(cursor);
  } while (cursor);

  return items;
}

export async function fetchSchoolAssignment(id: string): Promise<SchoolAssignment> {
  const value = await apiFetch<SchoolAssignment>(SCHOOL.endpoints.assignment(id));
  return {
    ...value,
    submission: value.submission ? schoolSubmission(value.submission) : null,
    history: value.history?.map(schoolSubmission),
  };
}

export async function fetchSchoolSubmission(id: string, signal?: AbortSignal) {
  return schoolSubmission(
    await apiFetch<SchoolSubmission>(SCHOOL.endpoints.submission(id), { signal }),
  );
}

export async function createSchoolSubmission(id: string, key: string, retryOfId?: string) {
  return schoolSubmission(
    await apiFetch<SchoolSubmission>(SCHOOL.endpoints.createSubmission(id), {
      json: retryOfId ? { retryOfId } : {},
      headers: { [SCHOOL.idempotencyHeader]: key },
    }),
  );
}

export async function finalizeSchoolSubmission(id: string, expectedRevision: number) {
  return schoolSubmission(
    await apiFetch<SchoolSubmission>(SCHOOL.endpoints.finalize(id), {
      json: { expectedRevision },
    }),
  );
}

export function schoolErrorMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return SCHOOL_COPY.sessionExpired;
    if (cause.status === 403) return SCHOOL_COPY.forbidden;
    if (cause.status === 404) return SCHOOL_COPY.unavailable;
    return cause.code && Object.hasOwn(SCHOOL_API_ERRORS, cause.code)
      ? SCHOOL_API_ERRORS[cause.code]
      : SCHOOL_COPY.error;
  }
  if (
    cause instanceof Error &&
    [...Object.values(SCHOOL_COPY), ...Object.values(LEARNING_COPY)].some(
      (message) => message === cause.message,
    )
  )
    return cause.message;
  return SCHOOL_COPY.error;
}

export async function attachSchoolFixture(assignmentId: string, submissionId: string) {
  return schoolSubmission(
    await apiFetch<SchoolSubmission>(SCHOOL.endpoints.fixture(assignmentId, submissionId), {
      method: 'POST',
    }),
  );
}

export async function cancelSchoolSubmission(id: string) {
  return schoolSubmission(
    await apiFetch<SchoolSubmission>(SCHOOL.endpoints.cancel(id), { method: 'POST' }),
  );
}
