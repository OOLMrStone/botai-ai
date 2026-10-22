import { useCallback, useEffect, useRef, useState } from 'react';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { fetchCurrentUser, logoutUser } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import {
  fetchPipelineRuns,
  loginPipelineConsole,
  pipelineRequestError,
} from '@/lib/api/pipeline-console';
import type { PipelineRunSummary } from '@/lib/api/pipeline-console-types';
import { mergePipelineRuns } from '@/lib/pipeline-console';
import { usePipelineRun } from '@/hooks/use-pipeline-run';

type SessionState = 'loading' | 'anonymous' | 'ready' | 'blocked' | 'unavailable';

export function usePipelineConsole() {
  const [session, setSession] = useState<SessionState>('loading');
  const [hasSession, setHasSession] = useState(false);
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [runs, setRuns] = useState<PipelineRunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const paginationInitialized = useRef(false);
  const actorGeneration = useRef(0);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      actorGeneration.current += 1;
      paginationInitialized.current = false;
      setNextCursor(null);
      setHasSession(false);
      setSession('anonymous');
      setRuns([]);
      setSelectedId(null);
    } else if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
      actorGeneration.current += 1;
      paginationInitialized.current = false;
      setNextCursor(null);
      setSession('blocked');
      setRuns([]);
      setSelectedId(null);
      setError(cause.status === 403 ? COPY.errors.forbidden : COPY.errors.unavailable);
    } else setError(pipelineRequestError(cause));
  }, []);

  useEffect(() => {
    let active = true;
    void fetchCurrentUser()
      .then((user) => {
        if (!active) return;
        setHasSession(Boolean(user));
        setSession(user ? 'ready' : 'anonymous');
        try {
          setSelectedId(sessionStorage.getItem(CONFIG.selectionKey));
        } catch {
          /* Приватный режим может запрещать хранилище */
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setSession('unavailable');
          setError(pipelineRequestError(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [bootstrapVersion]);

  useEffect(() => {
    if (session !== 'ready') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    async function poll() {
      if (controller.signal.aborted || document.hidden || pending) return;
      pending = true;
      try {
        const page = await fetchPipelineRuns(null, controller.signal);
        if (controller.signal.aborted) return;
        setRuns((current) => mergePipelineRuns(current, page.items));
        setListLoading(false);
        if (!paginationInitialized.current) {
          setNextCursor(page.nextCursor);
          paginationInitialized.current = true;
        }
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setListLoading(false);
          handleError(cause);
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) timer = setTimeout(poll, CONFIG.idlePollMs);
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
  }, [session, refreshVersion, handleError]);

  const selected = usePipelineRun(
    session === 'ready' ? selectedId : null,
    refreshVersion,
    handleError,
  );

  function select(id: string | null) {
    setSelectedId(id);
    try {
      if (id) sessionStorage.setItem(CONFIG.selectionKey, id);
      else sessionStorage.removeItem(CONFIG.selectionKey);
    } catch {
      /* Выбор продолжает работать без сохранения между перезагрузками */
    }
  }

  async function login(email: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await loginPipelineConsole(email, password);
      setHasSession(true);
      setListLoading(true);
      setSession('ready');
      return true;
    } catch (cause) {
      setError(pipelineRequestError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await logoutUser();
      actorGeneration.current += 1;
      setHasSession(false);
      setSession('anonymous');
      setRuns([]);
      select(null);
      setError(null);
      paginationInitialized.current = false;
      setNextCursor(null);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const generation = actorGeneration.current;
    try {
      const page = await fetchPipelineRuns(nextCursor);
      if (generation !== actorGeneration.current) return;
      setRuns((current) => mergePipelineRuns(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (generation === actorGeneration.current) handleError(cause);
    } finally {
      setLoadingMore(false);
    }
  }

  function refresh() {
    setRefreshVersion((value) => value + 1);
  }
  function reconnect() {
    setSession('loading');
    setError(null);
    setBootstrapVersion((value) => value + 1);
  }
  function accept(run: PipelineRunSummary) {
    setRuns((current) => mergePipelineRuns(current, [run]));
    select(run.id);
    refresh();
  }

  return {
    session,
    hasSession,
    runs,
    selectedId,
    selected,
    error,
    busy,
    loadingMore,
    listLoading,
    nextCursor,
    login,
    logout,
    select,
    loadMore,
    refresh,
    reconnect,
    accept,
  };
}

export type PipelineConsoleState = ReturnType<typeof usePipelineConsole>;
