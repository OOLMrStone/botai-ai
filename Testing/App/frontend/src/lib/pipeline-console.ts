import {
  PIPELINE_CONSOLE as CONFIG,
  PIPELINE_COPY,
  PIPELINE_PHASE_COPY,
  PIPELINE_STATE_COPY,
  PIPELINE_ERROR_COPY,
  PIPELINE_OBSERVER_EVENTS,
  PIPELINE_FAILURE_COPY,
} from '@/config/pipeline-console';
import type {
  PipelineEvent,
  PipelineFailure,
  PipelineEventPage,
  PipelineObserverStatus,
  PipelineRunState,
  PipelineRunSummary,
} from '@/lib/api/pipeline-console-types';

export function pipelinePollMs(
  state: PipelineRunState,
  observer?: PipelineObserverStatus,
): number | null {
  if (CONFIG.terminal.some((item) => item === state))
    return observer?.state === 'pending' ? CONFIG.activePollMs : null;
  return CONFIG.waitingForExpert.some((item) => item === state)
    ? CONFIG.idlePollMs
    : CONFIG.activePollMs;
}

export function pipelineObserverStatus(value: unknown): PipelineObserverStatus {
  if (!value || typeof value !== 'object' || !('state' in value) || !('expiresAt' in value))
    throw new Error(PIPELINE_COPY.errors.invalidEvents);
  const state = CONFIG.observerStates.find((state) => state === value.state);
  const expiresAt = value.expiresAt;
  if (
    !state ||
    !(
      expiresAt === null ||
      (typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)))
    )
  )
    throw new Error(PIPELINE_COPY.errors.invalidEvents);
  return { state, expiresAt };
}

export function pipelinePhaseLabel(phase: string, state: PipelineRunState) {
  if (Object.hasOwn(PIPELINE_PHASE_COPY, phase)) return PIPELINE_PHASE_COPY[phase];
  return Object.hasOwn(PIPELINE_STATE_COPY, state)
    ? PIPELINE_STATE_COPY[state]
    : PIPELINE_STATE_COPY.unknown;
}

export function pipelineErrorCode(code: string) {
  return Object.hasOwn(PIPELINE_ERROR_COPY, code)
    ? PIPELINE_ERROR_COPY[code]
    : PIPELINE_COPY.errors.run;
}

export function pipelineAttemptLabel(attempt: unknown, maximum: unknown): string {
  return typeof attempt === 'number' &&
    typeof maximum === 'number' &&
    Number.isSafeInteger(attempt) &&
    Number.isSafeInteger(maximum) &&
    attempt > 0 &&
    maximum >= attempt
    ? PIPELINE_COPY.attempt(attempt, maximum)
    : '';
}

export function pipelineFailureCategory(category: unknown): string {
  return typeof category === 'string' && Object.hasOwn(PIPELINE_FAILURE_COPY, category)
    ? PIPELINE_FAILURE_COPY[category as keyof typeof PIPELINE_FAILURE_COPY]
    : '';
}

export function pipelineFailureLabel(failure?: PipelineFailure | null): string {
  if (!failure) return '';
  const phase = Object.hasOwn(PIPELINE_PHASE_COPY, failure.phase)
    ? PIPELINE_PHASE_COPY[failure.phase]
    : '';
  return PIPELINE_COPY.diagnostic(
    [
      pipelineFailureCategory(failure.category),
      phase,
      pipelineAttemptLabel(failure.attempt, failure.maxAttempts),
    ].filter(Boolean),
  );
}

export function pipelineEventDetails(event: PipelineEvent) {
  return {
    ...event.data,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    createdAt: event.createdAt,
  };
}

export function pipelineEventAction(
  event: Pick<PipelineEvent, 'phase' | 'state' | 'type'> & Partial<Pick<PipelineEvent, 'data'>>,
) {
  const action = Object.hasOwn(PIPELINE_OBSERVER_EVENTS, event.type)
    ? PIPELINE_OBSERVER_EVENTS[event.type].label
    : pipelinePhaseLabel(event.phase, event.state);
  const attempt = pipelineAttemptLabel(
    event.data?.attempt,
    event.data?.maxAttempts ?? event.data?.max_attempts,
  );
  const category = pipelineFailureCategory(
    event.data?.failureCategory ?? event.data?.failure_category,
  );
  return PIPELINE_COPY.diagnostic([action, category, attempt].filter(Boolean));
}

export function pipelineEventLabel(
  event: Pick<PipelineEvent, 'phase' | 'state' | 'type'> & Partial<Pick<PipelineEvent, 'data'>>,
) {
  const phase = pipelinePhaseLabel(event.phase, event.state);
  return Object.hasOwn(PIPELINE_PHASE_COPY, event.phase) &&
    Object.hasOwn(PIPELINE_OBSERVER_EVENTS, event.type)
    ? PIPELINE_COPY.event(phase, pipelineEventAction(event))
    : phase;
}

export interface PipelineTimelineEntry {
  kind: 'stage' | 'event';
  summary: PipelineEvent;
  events: PipelineEvent[];
}

export function groupPipelineEvents(events: PipelineEvent[]): PipelineTimelineEntry[] {
  const timeline: PipelineTimelineEntry[] = [];
  const stages = new Map<string, PipelineTimelineEntry>();

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const isStage = CONFIG.stageEvents.some((type) => type === event.type);
    const isDetail = CONFIG.stageDetails.some((type) => type === event.type);
    const stage = stages.get(event.phase);

    if (stage && (isStage || isDetail)) {
      stage.events.push(event);
      if (isStage) stage.summary = event;
      continue;
    }

    const entry: PipelineTimelineEntry = {
      kind: isStage ? 'stage' : 'event',
      summary: event,
      events: [event],
    };
    timeline.push(entry);
    if (isStage) stages.set(event.phase, entry);
  }

  return timeline;
}

export function mergePipelineRuns(current: PipelineRunSummary[], incoming: PipelineRunSummary[]) {
  const values = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) {
    const previous = values.get(run.id);
    if (
      previous &&
      (previous.revision > run.revision ||
        (previous.revision === run.revision && previous.updatedAt > run.updatedAt))
    )
      continue;
    values.set(run.id, run);
  }
  return Array.from(values.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergePipelineEvents(current: PipelineEvent[], incoming: PipelineEvent[]) {
  const values = new Map(current.map((event) => [event.seq, event]));
  for (const event of incoming) values.set(event.seq, event);
  return Array.from(values.values())
    .sort((a, b) => a.seq - b.seq)
    .slice(-CONFIG.eventDisplayLimit);
}

export function pipelineEventCursor(page: PipelineEventPage, after: number): number {
  if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean')
    throw new Error(PIPELINE_COPY.errors.invalidEvents);
  let previous = after;
  for (const event of page.items) {
    if (!Number.isSafeInteger(event.seq) || event.seq <= previous)
      throw new Error(PIPELINE_COPY.errors.invalidEvents);
    previous = event.seq;
  }
  if (page.nextAfter !== previous || (page.hasMore && !page.items.length))
    throw new Error(PIPELINE_COPY.errors.invalidEvents);
  return previous;
}

export function validatePipelineFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!CONFIG.mimeTypes.some((type) => type === file.type)) return PIPELINE_COPY.errors.fileType;
  if (file.size > CONFIG.maxFileBytes) return PIPELINE_COPY.errors.fileSize;
  if (!file.size) return PIPELINE_COPY.errors.emptyFile;
  return null;
}

export function pipelineTime(value: string, includeDate = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(CONFIG.locale, {
    ...(includeDate ? ({ day: 'numeric', month: 'short' } as const) : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function pipelinePrivateUrl(value: string | null): string | null {
  if (!value || !value.startsWith('/api/') || value.includes('\\') || value.includes('/../'))
    return null;
  return value;
}

export function pipelineStateTone(state: PipelineRunState) {
  if (['completed', 'awaiting_expert', 'returned'].includes(state)) return 'success';
  if (state === 'failed') return 'failure';
  if (['unknown', 'cancelled'].includes(state)) return 'muted';
  return 'active';
}

export function pipelineSubmissionUncertain(status?: number, code?: string) {
  if (CONFIG.preDispatchErrors.some((value) => value === code)) return false;
  return status === undefined || status >= 500;
}

export function pipelineEventTone(event: Pick<PipelineEvent, 'phase' | 'state' | 'type'>) {
  if (!Object.hasOwn(PIPELINE_PHASE_COPY, event.phase)) return 'muted';
  return Object.hasOwn(PIPELINE_OBSERVER_EVENTS, event.type)
    ? PIPELINE_OBSERVER_EVENTS[event.type].tone
    : pipelineStateTone(event.state);
}
