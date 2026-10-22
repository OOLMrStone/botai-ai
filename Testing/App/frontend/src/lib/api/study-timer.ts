import { STUDY_TIMER } from '@/config/study-timer';
import { apiFetch } from '@/lib/api/client';
import type { Stats } from '@/lib/api/stats';

export interface StudyTimerState {
  sessionId: string | null;
  clientId: string | null;
  attemptId: string | null;
  active: boolean;
  lastAcknowledgedAt: string | null;
  serverNow: string;
  heartbeatSeconds: number;
  maxGapSeconds: number;
  acceptedSeconds: number;
  dailyActiveSeconds: number;
  attemptActiveSeconds: number;
  stats: Stats;
}

export type StudyTimerCommand =
  | { kind: 'start'; eventId: string; attemptId: string; clientId: string }
  | { kind: 'heartbeat' | 'pause'; eventId: string; sessionId: string };

export function sendStudyTimer(command: StudyTimerCommand): Promise<StudyTimerState> {
  const { kind, ...json } = command;
  return apiFetch(STUDY_TIMER.endpoints[kind], { json, keepalive: kind === 'pause' });
}
