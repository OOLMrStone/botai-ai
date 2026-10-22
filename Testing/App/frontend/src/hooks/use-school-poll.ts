'use client';

import { useEffect } from 'react';
import { SCHOOL } from '@/config/school';
import { ApiError } from '@/lib/api/client';
import {
  fetchSchoolAssignment,
  fetchSchoolAssignments,
  fetchSchoolSubmission,
} from '@/lib/api/school';
import { useSchoolStore } from '@/stores/school-store';
import { useSchoolError } from '@/hooks/use-school-error';

export function useSchoolPoll(
  sessionId: string | null,
  submissionId: string | null,
  delay: number | null,
) {
  const reportError = useSchoolError();
  useEffect(() => {
    if (!sessionId || delay === null) return;
    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const schedule = (wait = delay) => {
      clearTimeout(timer);
      if (!disposed && !stopped && document.visibilityState === 'visible')
        timer = setTimeout(() => void poll(), wait);
    };
    const poll = async () => {
      if (disposed || stopped || inFlight || document.visibilityState !== 'visible') return;
      if (useSchoolStore.getState().busy) {
        schedule();
        return;
      }
      inFlight = true;
      let nextDelay = delay;

      try {
        const value = submissionId
          ? await fetchSchoolSubmission(submissionId, controller.signal)
          : await fetchSchoolAssignments();
        const before = useSchoolStore.getState().assignment;
        const fresh =
          !Array.isArray(value) &&
          before?.submission?.id === value.id &&
          before.submission.status !== value.status
            ? await fetchSchoolAssignment(before.id)
            : null;
        const store = useSchoolStore.getState();
        if (disposed || store.session?.id !== sessionId || store.busy) return;
        if (Array.isArray(value)) store.setAssignments(value);
        else {
          store.acceptSubmission(value);
          if (fresh && store.assignment?.id === fresh.id) store.setAssignment(fresh);
        }
      } catch (cause) {
        if (disposed) return;
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          stopped = true;
        }
        reportError(cause);
        nextDelay = SCHOOL.failurePollMs;
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    };
    const onVisible = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [sessionId, submissionId, delay, reportError]);
}
