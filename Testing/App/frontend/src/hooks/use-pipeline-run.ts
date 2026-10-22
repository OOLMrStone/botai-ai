import { useEffect, useState } from 'react';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { ApiError } from '@/lib/api/client';
import {
  fetchPipelineEvents,
  fetchPipelineRun,
  pipelineRequestError,
} from '@/lib/api/pipeline-console';
import type { PipelineEvent, PipelineRunDetail } from '@/lib/api/pipeline-console-types';
import { mergePipelineEvents, pipelineEventCursor, pipelinePollMs } from '@/lib/pipeline-console';

interface RunView {
  id: string;
  detail: PipelineRunDetail | null;
  events: PipelineEvent[];
  error: string | null;
}

export function usePipelineRun(
  id: string | null,
  refreshVersion: number,
  onAuthError: (cause: unknown) => void,
) {
  const [view, setView] = useState<RunView | null>(null);

  useEffect(() => {
    if (!id) return;
    const runId = id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let events: PipelineEvent[] = [];
    let pending = false;
    let finished = false;

    async function poll() {
      if (pending || controller.signal.aborted || document.hidden || finished) return;
      pending = true;
      let nextPoll: number | null = CONFIG.reconnectPollMs;
      try {
        const detail = await fetchPipelineRun(runId, controller.signal);
        let observer = detail.observer;
        let hasMore = true;
        while (hasMore) {
          const page = await fetchPipelineEvents(runId, cursor, controller.signal);
          cursor = pipelineEventCursor(page, cursor);
          events = mergePipelineEvents(events, page.items);
          hasMore = page.hasMore;
          observer = page.observer;
        }
        if (controller.signal.aborted) return;
        setView({ id: runId, detail: { ...detail, observer }, events, error: null });
        nextPoll = pipelinePollMs(detail.state, observer);
        finished = nextPoll === null;
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          finished = true;
          onAuthError(cause);
        }
        if (cause instanceof ApiError && cause.status === 404) finished = true;
        const accessLost = cause instanceof ApiError && [401, 403, 404].includes(cause.status);
        if (accessLost) events = [];
        setView((current) => ({
          id: runId,
          detail: !accessLost && current?.id === runId ? current.detail : null,
          events,
          error: pipelineRequestError(cause, COPY.errors.load),
        }));
      } finally {
        pending = false;
        if (!controller.signal.aborted && !finished && nextPoll !== null)
          timer = setTimeout(poll, nextPoll);
      }
    }
    function wake() {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    }
    void poll();
    document.addEventListener('visibilitychange', wake);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [id, refreshVersion, onAuthError]);

  return view?.id === id ? view : null;
}
