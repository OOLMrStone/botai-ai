import { STUDY_TIMER } from '@/config/study-timer';
import type { StudyTimerCommand, StudyTimerState } from '@/lib/api/study-timer';

export type StudyTimerStatus = 'connecting' | 'active' | 'paused' | 'offline' | 'elsewhere';
export interface StudyTimerView {
  seconds: number;
  status: StudyTimerStatus;
}
interface TimerDependencies {
  attemptId: string;
  clientId: string;
  now: () => number;
  eventId: () => string;
  send: (command: StudyTimerCommand) => Promise<StudyTimerState>;
  accept: (state: StudyTimerState) => void;
  changed: () => void;
}

export function formatTimerSeconds(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / STUDY_TIMER.secondsPerMinute)}:${String(whole % STUDY_TIMER.secondsPerMinute).padStart(STUDY_TIMER.digits, '0')}`;
}

// Новое поколение ждёт закрытия предыдущего, чтобы запоздалый старт не перехватил его сессию.
export function createStudyTimerLifecycle() {
  let precedingDisposal = Promise.resolve();

  return (deps: TimerDependencies) => {
    const ready = precedingDisposal;
    const timer = createStudyTimer({
      ...deps,
      send: async (command) => {
        await ready;
        return deps.send(command);
      },
    });
    let disposal: Promise<void> | null = null;

    return {
      ...timer,
      dispose: () => {
        if (!disposal) {
          disposal = Promise.all([ready, timer.dispose()]).then(() => {});
          precedingDisposal = disposal;
        }
        return disposal;
      },
    };
  };
}

// Запросы идут последовательно: пауза не может обогнать старт или подтверждение времени.
export function createStudyTimer(deps: TimerDependencies) {
  let wanted = false;
  let blocked = false;
  let pauseRequired = false;
  let disposed = false;
  let sessionId: string | null = null;
  let seconds = 0;
  let acknowledgedAt = deps.now();
  let maxGap = STUDY_TIMER.defaultMaxGapSeconds as number;
  let status: StudyTimerStatus = 'paused';
  let pending: StudyTimerCommand | null = null;
  let inflight: Promise<void> | null = null;

  const changed = () => {
    if (!disposed) deps.changed();
  };
  const command = (kind: 'heartbeat' | 'pause'): StudyTimerCommand => ({
    kind,
    eventId: deps.eventId(),
    sessionId: sessionId!,
  });
  const run = async () => {
    if (!pending) return;
    const sent = pending;
    try {
      const state = await deps.send(sent);
      pending = null;
      sessionId = sent.kind === 'pause' ? null : state.sessionId;
      seconds = state.attemptActiveSeconds;
      acknowledgedAt = deps.now();
      maxGap = state.maxGapSeconds;
      status = wanted && state.active ? 'active' : 'paused';
      if (!disposed) deps.accept(state);
      if ((pauseRequired || !wanted) && sessionId) {
        pending = command('pause');
        await run();
      } else if (sent.kind === 'pause') {
        pauseRequired = false;
        if (wanted && !disposed) {
          pending = {
            kind: 'start',
            eventId: deps.eventId(),
            attemptId: deps.attemptId,
            clientId: deps.clientId,
          };
          await run();
        }
      }
    } catch (error) {
      const stale =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'activity_session_stale';
      status = stale ? 'elsewhere' : 'offline';
      if (stale) {
        blocked = true;
        pending = null;
        sessionId = null;
      } else if (sent.kind === 'pause') {
        pauseRequired = false;
        // Не начисляем скрытый интервал повтором запоздавшей паузы; новый вход создаст новую сессию.
        pending = null;
        sessionId = null;
      } else if (!wanted) {
        pending = sessionId ? command('pause') : null;
        if (pending) await run();
      }
    }
    changed();
  };
  const flush = (): Promise<void> => {
    if (inflight) return inflight;
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  };
  const tick = () => {
    if (disposed || !wanted || blocked) return Promise.resolve();
    if (!pending)
      pending = sessionId
        ? command('heartbeat')
        : {
            kind: 'start',
            eventId: deps.eventId(),
            attemptId: deps.attemptId,
            clientId: deps.clientId,
          };
    if (!sessionId) status = 'connecting';
    changed();
    return flush();
  };
  const setActive = (active: boolean) => {
    const previous = wanted;
    wanted = active;
    if (active) {
      if (!previous) blocked = false;
      return previous ? Promise.resolve() : tick();
    }
    pauseRequired = Boolean(sessionId || inflight);
    status = 'paused';
    changed();
    if (!inflight && sessionId) pending = command('pause');
    return flush();
  };
  return {
    tick,
    setActive,
    view: (): StudyTimerView => ({
      seconds:
        seconds +
        (status === 'active' && wanted
          ? Math.min(
              maxGap,
              Math.max(
                0,
                Math.floor((deps.now() - acknowledgedAt) / STUDY_TIMER.millisecondsPerSecond),
              ),
            )
          : 0),
      status,
    }),
    dispose: () => {
      const result = setActive(false);
      disposed = true;
      return result;
    },
  };
}
