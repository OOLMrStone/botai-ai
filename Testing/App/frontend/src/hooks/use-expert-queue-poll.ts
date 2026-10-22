'use client';

import { useEffect, useRef } from 'react';
import { EXPERT, EXPERT_COPY, type ExpertSession } from '@/config/expert';
import { ApiError } from '@/lib/api/client';
import { fetchExpertWorkspace } from '@/lib/api/expert';
import { useExpertStore } from '@/stores/expert-store';

export function useExpertQueuePoll(session: ExpertSession | null) {
  const running = useRef(false);

  useEffect(() => {
    if (!session || session.mode !== 'live') return;
    let active = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useExpertStore.subscribe((next, previous) => {
      if (
        next.session !== previous.session ||
        next.sessionOwner !== previous.sessionOwner ||
        next.works !== previous.works ||
        next.busy !== previous.busy ||
        next.loading !== previous.loading
      )
        generation += 1;
    });
    const schedule = () => {
      clearTimeout(timer);
      if (
        active &&
        document.visibilityState === 'visible' &&
        useExpertStore.getState().session === session
      )
        timer = setTimeout(() => void refresh(), EXPERT.queuePollMs);
    };
    const refresh = async () => {
      clearTimeout(timer);
      if (!active || document.visibilityState !== 'visible') return;
      const snapshot = useExpertStore.getState();
      if (running.current || snapshot.busy || snapshot.loading || snapshot.session !== session) {
        schedule();
        return;
      }
      const startedAt = generation;
      const isCurrent = () => {
        const current = useExpertStore.getState();

        return (
          active &&
          generation === startedAt &&
          current.session === session &&
          current.sessionOwner === snapshot.sessionOwner &&
          current.works === snapshot.works &&
          !current.busy &&
          !current.loading
        );
      };
      running.current = true;

      try {
        const workspace = await fetchExpertWorkspace(session);
        const current = useExpertStore.getState();
        if (!isCurrent() || document.visibilityState !== 'visible') return;
        const olderRevision = workspace.works.some((work) => {
          const previous = current.works.find((candidate) => candidate.id === work.id);

          return work.tasks.some((task) => {
            const saved = previous?.tasks.find((candidate) => candidate.id === task.id);

            return saved && task.revision < saved.revision;
          });
        });
        if (olderRevision) return;
        const hasNewWork = workspace.works.some(
          (work) =>
            work.status === 'pending' &&
            !current.works.some((candidate) => candidate.id === work.id),
        );

        current.setWorkspace(workspace);
        if (hasNewWork) current.setFeedback(EXPERT_COPY.newWorkReady);
      } catch (cause) {
        if (
          isCurrent() &&
          cause instanceof ApiError &&
          (cause.status === 401 || cause.status === 403)
        ) {
          const current = useExpertStore.getState();
          current.setSession(null);
          current.setError(
            cause.status === 401 ? EXPERT_COPY.errors.session : EXPERT_COPY.errors.role,
          );
        }
        // Сетевой сбой повторим, а потеря доступа скрывает кабинет без удаления черновиков.
      } finally {
        running.current = false;
        schedule();
      }
    };
    const onVisible = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void refresh();
    };

    schedule();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session]);
}
