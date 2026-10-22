'use client';

import { useEffect } from 'react';
import { EXPERT, EXPERT_COPY, type ExpertSession, type ExpertTask } from '@/config/expert';
import { expertErrorMessage, fetchExpertGradeJob } from '@/lib/api/expert';
import { ApiError } from '@/lib/api/client';
import { expertGradeActive, expertGradeFeedback, expertGradeFailure } from '@/lib/expert';
import { useExpertStore } from '@/stores/expert-store';

export function useExpertGradePoll(
  session: ExpertSession | null,
  workId: string | null,
  task: ExpertTask | null,
) {
  const jobId = task?.gradingJob?.id;
  const jobState = task?.gradingJob?.state;
  const revision = task?.revision;

  useEffect(() => {
    if (!session || session.mode !== 'live' || !workId || !jobId || !expertGradeActive(jobState))
      return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const work = await fetchExpertGradeJob(session, workId, jobId);
        if (!active) return;
        const store = useExpertStore.getState();
        const current = store.works.find((candidate) => candidate.id === workId)?.tasks[0];
        const result = work.tasks[0];
        if (!result || (current && current.revision > result.revision)) return;
        store.acceptWork(work, []);
        const state = result.gradingJob?.state;
        if (state === 'succeeded') store.setFeedback(EXPERT_COPY.graded);
        else if (state === 'failed') store.setError(expertGradeFailure(result.gradingJob?.failure));
        else if (state === 'stale') store.setError(EXPERT_COPY.errors.gradeStale);
        else if (state === 'unknown')
          store.setFeedback(expertGradeFeedback(state, result.gradingJob?.failure));
        else if (expertGradeActive(state)) {
          store.setFeedback(expertGradeFeedback(state));
          timer = setTimeout(() => void poll(), EXPERT.gradePollMs);
        }
      } catch (cause) {
        if (!active) return;
        const store = useExpertStore.getState();
        if (cause instanceof ApiError && cause.status < 500) {
          store.setError(expertErrorMessage(cause));
          return;
        }
        store.setFeedback(EXPERT_COPY.gradeConnection);
        timer = setTimeout(() => void poll(), EXPERT.gradePollMs);
      }
    };
    timer = setTimeout(() => void poll(), EXPERT.gradePollMs);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, workId, jobId, jobState, revision]);
}
