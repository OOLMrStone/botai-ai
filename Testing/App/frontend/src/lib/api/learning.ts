import { apiFetch } from '@/lib/api/client';
import { ATTEMPT_ENDPOINTS } from '@/config/attempts';
import type {
  Attempt,
  AttemptPatch,
  Catalog,
  ExamTemplate,
  Page,
  Solution,
  Submission,
  Task,
  TrainingRequest,
  Attachment,
  SolutionDocument,
} from '@/lib/api/learning-types';
const keyHeader = (key: string) => ({ 'Idempotency-Key': key });
export const fetchCatalog = () => apiFetch<Catalog>('/api/catalog');
export const fetchFavorites = (cursor?: string) =>
  apiFetch<Page<Task>>(`/api/favorites${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const fetchExams = (cursor?: string) =>
  apiFetch<Page<ExamTemplate>>(
    `/api/mock-exams${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
export const fetchHistory = (cursor?: string) =>
  apiFetch<Page<Attempt>>(`/api/attempts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const createTraining = (json: TrainingRequest, key: string) =>
  apiFetch<Attempt>('/api/training-attempts', { json, headers: keyHeader(key) });
export const createExamAttempt = (id: string, key: string) =>
  apiFetch<Attempt>(`/api/mock-exams/${id}/attempts`, { method: 'POST', headers: keyHeader(key) });
export const fetchAttempt = (id: string) => apiFetch<Attempt>(`/api/attempts/${id}`);
export const patchAttempt = (id: string, json: AttemptPatch) =>
  apiFetch<Attempt>(`/api/attempts/${id}`, { method: 'PATCH', json });
export const deleteAttempt = (id: string) =>
  apiFetch<void>(`/api/attempts/${id}`, { method: 'DELETE' });
export const recordAttemptExit = (id: string, eventId: string) =>
  apiFetch<void>(ATTEMPT_ENDPOINTS.exit(id), { json: { eventId }, keepalive: true });
export const checkAttempt = (id: string, revision: number, key: string, itemIds: string[]) =>
  apiFetch<Attempt>(`/api/attempts/${id}/checks`, {
    json: { revision, itemIds },
    headers: keyHeader(key),
  });
export const createSubmission = (
  attemptId: string,
  attemptItemId: string,
  inputRevision: number,
  key: string,
  retryOfId?: string,
) =>
  apiFetch<Submission>('/api/submissions', {
    json: { attemptId, attemptItemId, inputRevision, retryOfId },
    headers: keyHeader(key),
  });
export const fetchSubmission = (id: string) => apiFetch<Submission>(`/api/submissions/${id}`);
export async function uploadImage(id: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<Attachment>(`/api/submissions/${id}/images`, { method: 'POST', body });
}
export async function uploadDocument(id: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<SolutionDocument>(`/api/submissions/${id}/documents`, { method: 'POST', body });
}
export const deleteDocument = (id: string, documentId: string) =>
  apiFetch<void>(`/api/submissions/${id}/documents/${documentId}`, { method: 'DELETE' });
export const deleteImage = (id: string, imageId: string) =>
  apiFetch<void>(`/api/submissions/${id}/images/${imageId}`, { method: 'DELETE' });
export const reportClientRejection = (id: string, expectedRevision: number, reason: string) =>
  apiFetch<void>(`/api/submissions/${id}/client-rejection`, { json: { expectedRevision, reason } });
export const finalizeSubmission = (id: string, expectedRevision: number) =>
  apiFetch<Submission>(`/api/submissions/${id}/finalize`, { json: { expectedRevision } });
export const cancelSubmission = (id: string) =>
  apiFetch<Submission>(`/api/submissions/${id}/cancel`, { method: 'POST' });
export const fetchSolution = (attemptId: string, itemId: string) =>
  apiFetch<Solution>(`/api/attempts/${attemptId}/items/${itemId}/solution`);
export const revealSolution = (
  attemptId: string,
  itemId: string,
  expectedAnswerRevision: number,
  expectedSubmissionId: string | null,
  expectedSubmissionRevision: number | null,
) =>
  apiFetch<Solution>(`/api/attempts/${attemptId}/items/${itemId}/solution-reveal`, {
    json: { expectedAnswerRevision, expectedSubmissionId, expectedSubmissionRevision },
  });

export async function collectPages<T>(load: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
export const fetchUnfinished = (cursor?: string) =>
  apiFetch<Page<Attempt>>(
    `/api/attempts?status=unfinished${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
export const fetchAllTasks = () =>
  collectPages<Task>((cursor) =>
    apiFetch<Page<Task>>(`/api/tasks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  );
export const setFavorite = (id: string, favorite: boolean) =>
  apiFetch<{ taskId: string; isFavourite: boolean }>(`/api/favorites/${id}`, {
    method: favorite ? 'PUT' : 'DELETE',
  });
