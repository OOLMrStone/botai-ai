import type { Attempt } from '@/lib/api/learning-types';

class AttemptDraft {
  private draftAnswers: Record<string, string> = {};
  private accepted: Attempt | null = null;
  private version = 0;
  private sequence = 0;
  private operation: Promise<unknown> | null = null;

  get answers() {
    return this.draftAnswers;
  }
  get snapshot() {
    return this.accepted;
  }
  get generation() {
    return this.version;
  }
  get fetchSequence() {
    return this.sequence;
  }
  get pending() {
    return this.operation;
  }
  accept(snapshot: Attempt) {
    this.accepted = snapshot;
  }
  setAnswer(id: string, answer: string) {
    this.draftAnswers = { ...this.draftAnswers, [id]: answer };
  }
  acknowledge(id: string, answer: string | undefined) {
    if (answer === undefined || this.draftAnswers[id] !== answer) return;
    const next = { ...this.draftAnswers };
    delete next[id];
    this.draftAnswers = next;
  }
  clear() {
    this.draftAnswers = {};
  }
  startFetch() {
    return ++this.sequence;
  }
  startMutation() {
    this.version += 1;
  }
  track(operation: Promise<unknown>) {
    this.operation = operation;
  }
  finishMutation() {
    this.version += 1;
    this.operation = null;
  }
}

// Переходы внутри сайта сохраняют черновик, смена аккаунта удаляет всю память.
const sessions = new Map<string, AttemptDraft>();
export function attemptDraft(id: string): AttemptDraft {
  let session = sessions.get(id);
  if (!session) {
    session = new AttemptDraft();
    sessions.set(id, session);
  }
  return session;
}
export function ownsAttemptDraft(id: string, session: AttemptDraft) {
  return sessions.get(id) === session;
}
export function clearAttemptDrafts() {
  sessions.clear();
}
export function forgetAttemptDraft(id: string) {
  sessions.delete(id);
}
