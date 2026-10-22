'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { MockExamFilter, MockExamSort } from '@/config/mock-exams';
import type { TaskStatus, TrainingTask } from '@/config/tasks';
import { createMockExamSession } from '@/lib/mock-exams';
import { isTrainingAnswerCorrect } from '@/lib/task-training';

export interface MockExamSession {
  examId: string;
  currentIndex: number;
  answers: Record<string, string>;
  attachments: Record<string, string[]>;
  statuses: Record<string, TaskStatus>;
}

export interface MockExamResult {
  score: number;
  completedAt: string;
}

interface MockExamsState {
  sort: MockExamSort;
  filter: MockExamFilter;
  sessions: Record<string, MockExamSession>;
  results: Record<string, MockExamResult>;
  setSort: (sort: MockExamSort) => void;
  setFilter: (filter: MockExamFilter) => void;
  start: (examId: string) => void;
  resetExam: (examId: string) => void;
  setCurrentIndex: (examId: string, currentIndex: number) => void;
  setAnswer: (examId: string, taskId: string, answer: string) => void;
  checkAnswer: (examId: string, task: TrainingTask) => void;
  addAttachments: (examId: string, taskId: string, names: string[]) => void;
  removeAttachment: (examId: string, taskId: string, name: string) => void;
  check: (examId: string, statuses: Record<string, TaskStatus>, score: number) => void;
  complete: (examId: string, score: number) => void;
}

export const useMockExamsStore = create<MockExamsState>()(
  persist(
    (set) => ({
      sort: 'newest',
      filter: 'all',
      sessions: {},
      results: {},
      setSort: (sort) => set({ sort }),
      setFilter: (filter) => set({ filter }),
      start: (examId) =>
        set((state) => {
          const session = state.sessions[examId];
          return {
            sessions: {
              ...state.sessions,
              [examId]: session ? { ...session, currentIndex: 0 } : createMockExamSession(examId),
            },
          };
        }),
      resetExam: (examId) =>
        set((state) => {
          const results = { ...state.results };
          delete results[examId];

          return {
            sessions: {
              ...state.sessions,
              [examId]: createMockExamSession(examId),
            },
            results,
          };
        }),
      setCurrentIndex: (examId, currentIndex) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;
          return {
            sessions: { ...state.sessions, [examId]: { ...session, currentIndex } },
          };
        }),
      setAnswer: (examId, taskId, answer) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [examId]: {
                ...session,
                answers: { ...session.answers, [taskId]: answer },
                statuses: { ...session.statuses, [taskId]: 'unverified' },
              },
            },
          };
        }),
      checkAnswer: (examId, task) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;

          const status = isTrainingAnswerCorrect(task, session.answers[task.id])
            ? 'correct'
            : 'incorrect';

          return {
            sessions: {
              ...state.sessions,
              [examId]: {
                ...session,
                statuses: { ...session.statuses, [task.id]: status },
              },
            },
          };
        }),
      addAttachments: (examId, taskId, names) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;
          const currentNames = session.attachments[taskId] ?? [];
          const nextNames = [...new Set([...currentNames, ...names])];
          return {
            sessions: {
              ...state.sessions,
              [examId]: {
                ...session,
                attachments: { ...session.attachments, [taskId]: nextNames },
                statuses: { ...session.statuses, [taskId]: 'unverified' },
              },
            },
          };
        }),
      removeAttachment: (examId, taskId, name) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;

          const nextNames = (session.attachments[taskId] ?? []).filter(
            (attachmentName) => attachmentName !== name,
          );

          return {
            sessions: {
              ...state.sessions,
              [examId]: {
                ...session,
                attachments: { ...session.attachments, [taskId]: nextNames },
                statuses: { ...session.statuses, [taskId]: 'unverified' },
              },
            },
          };
        }),
      check: (examId, statuses, score) =>
        set((state) => {
          const session = state.sessions[examId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [examId]: { ...session, currentIndex: 0, statuses },
            },
            results: {
              ...state.results,
              [examId]: { score, completedAt: new Date().toISOString() },
            },
          };
        }),
      complete: (examId, score) =>
        set((state) => ({
          results: {
            ...state.results,
            [examId]: { score, completedAt: new Date().toISOString() },
          },
        })),
    }),
    {
      name: 'botai-mock-exams',
      version: 1,
    },
  ),
);
