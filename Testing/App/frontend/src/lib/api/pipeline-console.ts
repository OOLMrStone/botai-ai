import { AUTH_ENDPOINT } from '@/config/auth';
import {
  PIPELINE_CONSOLE as CONFIG,
  PIPELINE_COPY as COPY,
  PIPELINE_ERROR_COPY,
} from '@/config/pipeline-console';
import { loginUser } from '@/lib/api/auth';
import { ApiError, apiFetch } from '@/lib/api/client';
import { pipelineObserverStatus } from '@/lib/pipeline-console';
import type {
  PipelineEventPage,
  PipelineManualInput,
  PipelineRunDetail,
  PipelineRunPage,
} from '@/lib/api/pipeline-console-types';

export async function loginPipelineConsole(email: string, password: string) {
  await loginUser({ email, password });
  await apiFetch(AUTH_ENDPOINT.csrf);
}

export function pipelineRequestError(cause: unknown, fallback: string = COPY.errors.load) {
  if (cause instanceof ApiError)
    return cause.code && Object.hasOwn(PIPELINE_ERROR_COPY, cause.code)
      ? PIPELINE_ERROR_COPY[cause.code]
      : fallback;
  if (
    cause instanceof Error &&
    Object.values(COPY.errors).some((message) => message === cause.message)
  )
    return cause.message;
  return fallback;
}

export function fetchPipelineRuns(cursor: string | null = null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(CONFIG.pageLimit) });
  if (cursor) query.set('cursor', cursor);
  return apiFetch<PipelineRunPage>(`${CONFIG.endpoint}?${query}`, { signal });
}

export async function fetchPipelineRun(id: string, signal?: AbortSignal) {
  const run = await apiFetch<PipelineRunDetail>(`${CONFIG.endpoint}/${encodeURIComponent(id)}`, {
    signal,
  });
  return { ...run, observer: pipelineObserverStatus(run.observer) };
}

export async function fetchPipelineEvents(id: string, after: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ after: String(after), limit: String(CONFIG.eventLimit) });
  const page = await apiFetch<PipelineEventPage>(
    `${CONFIG.endpoint}/${encodeURIComponent(id)}/${CONFIG.eventsAction}?${query}`,
    { signal },
  );
  return { ...page, observer: pipelineObserverStatus(page.observer) };
}

export function submitPipelineRun(input: PipelineManualInput, idempotencyKey: string) {
  const body = new FormData();
  body.append('task_number', String(input.taskNumber));
  body.append('task_image', input.taskImage);
  for (const image of input.solutionImages) body.append('solution_images', image);
  return apiFetch<PipelineRunDetail>(`${CONFIG.endpoint}/${CONFIG.manualAction}`, {
    method: 'POST',
    headers: { [CONFIG.idempotencyHeader]: idempotencyKey },
    body,
  });
}
