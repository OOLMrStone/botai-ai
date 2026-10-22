'use client';
import { createClientId } from '@/lib/client-id';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IS_MOCK_API } from '@/config/env';
import { STUDY_TIMER, STUDY_TIMER_COPY } from '@/config/study-timer';
import { sendStudyTimer } from '@/lib/api/study-timer';
import {
  createStudyTimerLifecycle,
  formatTimerSeconds,
  type StudyTimerView,
} from '@/lib/study-timer';
import { acceptStudyStats } from '@/lib/user-stats-resource';

const createAttemptTimer = createStudyTimerLifecycle();

export function useAttemptActivity(id: string, enabled: boolean) {
  const controller = useRef<ReturnType<typeof createAttemptTimer> | null>(null);
  const [view, setView] = useState<StudyTimerView>({ seconds: 0, status: 'connecting' });

  useEffect(() => {
    if (!enabled || IS_MOCK_API) return;
    const timer = createAttemptTimer({
      attemptId: id,
      clientId: createClientId(),
      now: () => performance.now(),
      eventId: () => createClientId(),
      send: sendStudyTimer,
      accept: (state) => acceptStudyStats(state.stats),
      changed: () => setView(timer.view()),
    });
    controller.current = timer;
    const foreground = () =>
      void timer.setActive(document.visibilityState === 'visible' && document.hasFocus());
    const pause = () => void timer.setActive(false);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', foreground);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    window.addEventListener('online', foreground);
    const heartbeat = setInterval(() => void timer.tick(), STUDY_TIMER.heartbeatMs);
    const display = setInterval(() => setView(timer.view()), STUDY_TIMER.displayMs);
    foreground();
    return () => {
      controller.current = null;
      clearInterval(heartbeat);
      clearInterval(display);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('blur', pause);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('online', foreground);
      void timer.dispose();
    };
  }, [id, enabled]);

  const pause = useCallback(() => controller.current?.setActive(false) ?? Promise.resolve(), []);
  return {
    visible: enabled && !IS_MOCK_API,
    label: formatTimerSeconds(view.seconds),
    description: STUDY_TIMER_COPY[view.status],
    pause,
  };
}
