'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  EXPERT_COPY,
  type ExpertAnalysis,
  type ExpertBlock,
  type ExpertSession,
} from '@/config/expert';
import { ApiError } from '@/lib/api/client';
import {
  addExpertStudent,
  expertErrorMessage,
  fetchExpertSession,
  fetchExpertWorkspace,
  gradeExpertTask,
  loginExpert,
  logoutExpert,
  saveExpertTask,
  ExpertPartialSaveError,
  startExpertDemo,
} from '@/lib/api/expert';
import { getExpertQueue, isExpertTaskDirty, expertGradeFeedback } from '@/lib/expert';
import { useExpertStore } from '@/stores/expert-store';
import { useExpertGradePoll } from '@/hooks/use-expert-grade-poll';
import { useExpertQueuePoll } from '@/hooks/use-expert-queue-poll';

export function useExpertWorkspace() {
  const state = useExpertStore();
  const requestInFlight = useRef(false);
  const lifecycle = useRef(0);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    const store = useExpertStore.getState();
    store.setBusy(true);
    store.setError(null);
    store.setFeedback(null);

    try {
      await action();
      return true;
    } catch (cause) {
      if (cause instanceof ExpertPartialSaveError)
        store.acceptWork(
          cause.savedWork,
          cause.savedWork.tasks.map((task) => task.id),
        );
      const failure = cause instanceof ExpertPartialSaveError ? cause.failure : cause;
      if (failure instanceof ApiError && failure.status === 401) store.setSession(null);
      store.setError(expertErrorMessage(cause));
      return false;
    } finally {
      requestInFlight.current = false;
      useExpertStore.getState().setBusy(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (session: ExpertSession) => {
    const workspace = await fetchExpertWorkspace(session);
    const store = useExpertStore.getState();
    store.setSession(session);
    store.setWorkspace(workspace);
  }, []);

  const retry = useCallback(
    async () =>
      run(async () => {
        const store = useExpertStore.getState();
        store.setLoading(true);

        try {
          const session = await fetchExpertSession();
          if (session) await loadWorkspace(session);
          else store.setSession(null);
        } finally {
          store.setLoading(false);
        }
      }),
    [loadWorkspace, run],
  );

  useEffect(() => {
    const revision = ++lifecycle.current;
    const store = useExpertStore.getState();
    store.setLoading(true);
    void fetchExpertSession()
      .then(async (session) => {
        const workspace = session ? await fetchExpertWorkspace(session) : null;
        if (revision !== lifecycle.current) return;
        store.setSession(session);
        if (workspace) store.setWorkspace(workspace);
        store.setError(null);
      })
      .catch((cause: unknown) => {
        if (revision === lifecycle.current) store.setError(expertErrorMessage(cause));
      })
      .finally(() => {
        if (revision === lifecycle.current) store.setLoading(false);
      });

    return () => {
      lifecycle.current += 1;
    };
  }, []);

  const login = (email: string, password: string) =>
    run(async () => {
      const session = await loginExpert(email, password);
      await loadWorkspace(session);
    });
  const enterDemo = () =>
    run(async () => {
      const session = await startExpertDemo();
      await loadWorkspace(session);
    });
  const logout = (discard = false) =>
    run(async () => {
      const current = useExpertStore.getState();
      if (Object.keys(current.drafts).length && !discard)
        throw new Error(EXPERT_COPY.errors.unsavedSession);
      if (current.session) await logoutExpert(current.session);
      lifecycle.current += 1;
      current.reset();
    });
  const addStudent = (id: string) =>
    run(async () => {
      const current = useExpertStore.getState();
      if (!current.session) throw new ApiError(401, EXPERT_COPY.errors.session);
      current.setWorkspace(await addExpertStudent(current.session, id));
      current.setFeedback(EXPERT_COPY.studentAdded);
    });
  const persistTask = (action: 'approve' | 'grade') =>
    run(async () => {
      const current = useExpertStore.getState();
      const work = current.works.find((candidate) => candidate.id === current.selectedWorkId);
      const task = current.selectedTaskId
        ? (current.drafts[current.selectedTaskId] ??
          work?.tasks.find((candidate) => candidate.id === current.selectedTaskId))
        : null;
      if (!current.session) throw new ApiError(401, EXPERT_COPY.errors.session);
      if (!work || !task) throw new ApiError(404, EXPERT_COPY.errors.taskMissing);

      const saved =
        action === 'grade'
          ? await gradeExpertTask(current.session, work.id, task)
          : await saveExpertTask(current.session, work.id, task, true);
      current.acceptWork(saved, [task.id]);
      const gradeJob = saved.tasks.find((savedTask) => savedTask.id === task.id)?.gradingJob;
      const gradeState = gradeJob?.state;
      if (action === 'grade' && gradeState === 'failed')
        throw new Error(EXPERT_COPY.errors.gradeFailed);
      if (action === 'grade' && gradeState === 'stale')
        throw new Error(EXPERT_COPY.errors.gradeStale);
      current.setFeedback(
        action === 'grade'
          ? expertGradeFeedback(gradeState, gradeJob?.failure)
          : EXPERT_COPY.approvedTask,
      );
    });
  const savedWork = state.works.find((work) => work.id === state.selectedWorkId) ?? null;
  const selectedWork = savedWork
    ? { ...savedWork, tasks: savedWork.tasks.map((task) => state.drafts[task.id] ?? task) }
    : null;
  const selectedTask = selectedWork?.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
  const savedTask = savedWork?.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
  const hasUnsavedChanges = Object.keys(state.drafts).length > 0;
  useExpertGradePoll(state.session, savedWork?.id ?? null, savedTask);
  useExpertQueuePoll(state.session);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);

    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [hasUnsavedChanges]);

  return {
    session: state.session,
    loading: state.loading,
    busy: state.busy,
    error: state.error,
    feedback: state.feedback,
    view: state.view,
    query: state.query,
    sort: state.sort,
    filter: state.filter,
    students: state.students,
    allWorks: state.works,
    works: getExpertQueue(state.works, state.query, state.sort, state.filter),
    selectedWork,
    selectedTask,
    dirty: isExpertTaskDirty(selectedTask, savedTask),
    hasUnsavedChanges,
    pendingCount: state.works.filter((work) => work.status === 'pending').length,
    reviewedCount: state.works.filter((work) => work.status === 'reviewed').length,
    setView: state.setView,
    setQuery: state.setQuery,
    setSort: state.setSort,
    setFilter: state.setFilter,
    openWork: state.openWork,
    selectTask: state.selectTask,
    updateBlock: (block: ExpertBlock) => {
      if (requestInFlight.current) return false;
      state.updateBlock(block);

      return true;
    },
    updateAnalysis: (analysis: Partial<ExpertAnalysis>) => {
      if (requestInFlight.current) return false;
      state.updateAnalysis(analysis);

      return true;
    },
    discardChanges: state.discardChanges,
    clearFeedback: () => state.setFeedback(null),
    clearError: () => state.setError(null),
    login,
    enterDemo,
    logout,
    retry,
    addStudent,
    approveTask: () => persistTask('approve'),
    gradeTask: () => persistTask('grade'),
  };
}

export type ExpertWorkspace = ReturnType<typeof useExpertWorkspace>;
