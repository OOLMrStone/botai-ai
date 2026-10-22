'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { MOCK_EXAM_DEMO } from '@/config/mock-exam-demo';

export type DemoReviewStage = 'idle' | 'photo' | 'ready' | 'solution' | 'complete';

interface MockExamDemoState {
  resetRevision: number;
  stage: DemoReviewStage;
  previewUrl: string | null;
  file: File | null;
  completed: boolean;
  error: string | null;
  begin: (file: File, previewUrl: string) => void;
  setStage: (stage: DemoReviewStage) => void;
  finish: () => void;
  startChecking: () => void;
  cancelChecking: () => void;
  fail: (error: string) => void;
  reset: () => void;
  releasePreview: (previewUrl: string) => void;
}

const EMPTY_REVIEW = {
  stage: 'idle' as const,
  previewUrl: null,
  file: null,
  completed: false,
  error: null,
};

export const useMockExamDemoStore = create<MockExamDemoState>()(
  persist(
    (set) => ({
      ...EMPTY_REVIEW,
      resetRevision: 0,
      begin: (file, previewUrl) => set({ ...EMPTY_REVIEW, file, previewUrl, stage: 'photo' }),
      setStage: (stage) => set({ stage }),
      startChecking: () => set({ stage: 'solution', completed: false, error: null }),
      cancelChecking: () =>
        set((state) => (state.stage === 'solution' ? { stage: 'ready' } : state)),
      finish: () => set({ completed: true, stage: 'complete', file: null }),
      fail: (error) => set({ stage: 'idle', error, file: null }),
      releasePreview: (previewUrl) =>
        set((state) =>
          state.previewUrl === previewUrl
            ? { previewUrl: null, file: null, stage: state.completed ? 'complete' : 'idle' }
            : state,
        ),
      reset: () => set({ ...EMPTY_REVIEW, resetRevision: MOCK_EXAM_DEMO.resetRevision }),
    }),
    {
      name: MOCK_EXAM_DEMO.storageKey,
      partialize: ({ completed, resetRevision }) => ({ completed, resetRevision }),
    },
  ),
);
