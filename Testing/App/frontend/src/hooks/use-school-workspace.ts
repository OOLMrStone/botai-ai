'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SCHOOL } from '@/config/school';
import {
  fetchSchoolAssignment,
  fetchSchoolAssignments,
  fetchSchoolSession,
  loginSchool,
  logoutSchool,
} from '@/lib/api/school';
import { schoolPollDelay, schoolStatusPolling } from '@/lib/school';
import { useSchoolStore } from '@/stores/school-store';
import { useSchoolPoll } from '@/hooks/use-school-poll';
import { useSchoolError } from '@/hooks/use-school-error';

export function useSchoolWorkspace() {
  const state = useSchoolStore();
  const inFlight = useRef(false);
  const lifecycle = useRef(0);
  const reportError = useSchoolError();

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const store = useSchoolStore.getState();
      store.setBusy(true);
      store.setError(null);
      try {
        await action();
        return true;
      } catch (cause) {
        reportError(cause);
        return false;
      } finally {
        inFlight.current = false;
        useSchoolStore.getState().setBusy(false);
      }
    },
    [reportError],
  );

  useEffect(() => {
    const revision = ++lifecycle.current;
    const store = useSchoolStore.getState();
    store.setLoading(true);
    void fetchSchoolSession()
      .then(async (session) => {
        const assignments = session ? await fetchSchoolAssignments() : [];
        if (revision !== lifecycle.current) return;
        store.setSession(session);
        store.setAssignments(assignments);
        store.setError(null);
      })
      .catch((cause: unknown) => {
        if (revision === lifecycle.current) reportError(cause);
      })
      .finally(() => {
        if (revision === lifecycle.current) store.setLoading(false);
      });
    return () => {
      lifecycle.current += 1;
    };
  }, [reportError]);

  const login = (email: string, password: string) =>
    run(async () => {
      const session = await loginSchool(email, password);
      const assignments = session ? await fetchSchoolAssignments() : [];
      state.setSession(session);
      state.setAssignments(assignments);
    });
  const logout = () =>
    run(async () => {
      await logoutSchool();
      lifecycle.current += 1;
      state.reset();
    });
  const open = (id: string) =>
    run(async () => {
      state.setOpening(true);
      try {
        state.setAssignment(await fetchSchoolAssignment(id));
      } finally {
        state.setOpening(false);
      }
    });
  const refresh = () =>
    run(async () => {
      const current = useSchoolStore.getState();
      if (!current.session) {
        const session = await fetchSchoolSession();
        current.setSession(session);
        if (!session) return;
      }
      if (current.assignment)
        current.setAssignment(await fetchSchoolAssignment(current.assignment.id));
      else current.setAssignments(await fetchSchoolAssignments());
    });
  const back = () => {
    if (inFlight.current || useSchoolStore.getState().busy) return;
    state.setAssignment(null);
    state.setError(null);
  };

  const delay = state.assignment
    ? schoolPollDelay(state.assignment.submission)
    : state.assignments.some((assignment) => schoolStatusPolling(assignment.status))
      ? SCHOOL.reviewPollMs
      : null;
  useSchoolPoll(state.session?.id ?? null, state.assignment?.submission?.id ?? null, delay);

  return {
    ...state,
    visibleAssignments: state.assignments.filter(
      (assignment) => state.filter === SCHOOL.allNumbers || assignment.taskNumber === state.filter,
    ),
    login,
    logout,
    refresh,
    open,
    back,
  };
}

export type SchoolWorkspace = ReturnType<typeof useSchoolWorkspace>;
