'use client';

import { create } from 'zustand';

import { EXPERIMENTAL, EXPERIMENTAL_COPY } from '@/config/experimental';
import type { ExperimentalPointId } from '@/config/experimental';

export type ExperimentalEditor = 'verdict' | 'advice';

interface ExperimentalState {
  screen: 'queue' | 'review';
  selectedPointId: ExperimentalPointId | null;
  revealPointId: ExperimentalPointId | null;
  revealRevision: number;
  disputedPointIds: ExperimentalPointId[];
  sourceOpen: boolean;
  criterionOpen: boolean;
  editor: ExperimentalEditor | null;
  draftText: string;
  draftScore: number;
  verdict: string;
  advice: string;
  score: number;
  maxScore: number;
  confirmed: boolean;
  feedback: string | null;
  openStudent: () => void;
  openQueue: () => void;
  setSourceOpen: (open: boolean) => void;
  setCriterionOpen: (open: boolean) => void;
  selectPoint: (id: ExperimentalPointId) => void;
  setPointOpen: (id: ExperimentalPointId, open: boolean) => void;
  finishPointReveal: (id: ExperimentalPointId, revision: number) => void;
  cancelPointReveal: (revision?: number) => void;
  toggleDispute: (id: ExperimentalPointId) => void;
  openEditor: (field: ExperimentalEditor) => void;
  closeEditor: () => void;
  setDraftText: (draftText: string) => void;
  setDraftScore: (draftScore: number) => void;
  saveEdit: () => void;
  confirmReview: () => void;
  clearFeedback: () => void;
}

export const useExperimentalStore = create<ExperimentalState>((set) => ({
  screen: 'queue',
  selectedPointId: null,
  revealPointId: null,
  revealRevision: 0,
  disputedPointIds: [],
  sourceOpen: false,
  criterionOpen: false,
  editor: null,
  draftText: '',
  draftScore: EXPERIMENTAL.score,
  verdict: EXPERIMENTAL_COPY.verdict,
  advice: EXPERIMENTAL_COPY.advice,
  score: EXPERIMENTAL.score,
  maxScore: EXPERIMENTAL.maxScore,
  confirmed: false,
  feedback: null,
  openStudent: () =>
    set({
      screen: 'review',
      selectedPointId: null,
      revealPointId: null,
    }),
  openQueue: () =>
    set({
      screen: 'queue',
      selectedPointId: null,
      revealPointId: null,
      sourceOpen: false,
      criterionOpen: false,
      editor: null,
      feedback: null,
    }),
  setSourceOpen: (sourceOpen) => set({ sourceOpen, selectedPointId: null, revealPointId: null }),
  setCriterionOpen: (criterionOpen) =>
    set({ criterionOpen, selectedPointId: null, revealPointId: null }),
  selectPoint: (revealPointId) =>
    set((state) => ({
      selectedPointId: null,
      revealPointId,
      revealRevision: state.revealRevision + 1,
    })),
  setPointOpen: (id, open) =>
    set((state) => {
      if (open) return { selectedPointId: id, revealPointId: null };
      if (state.selectedPointId !== id) return state;

      return { selectedPointId: null, revealPointId: null };
    }),
  finishPointReveal: (id, revision) =>
    set((state) =>
      state.revealPointId === id && state.revealRevision === revision
        ? { selectedPointId: id, revealPointId: null }
        : state,
    ),
  cancelPointReveal: (revision) =>
    set((state) =>
      revision === undefined || state.revealRevision === revision ? { revealPointId: null } : state,
    ),
  toggleDispute: (id) =>
    set((state) => {
      const alreadyDisputed = state.disputedPointIds.includes(id);

      return {
        disputedPointIds: alreadyDisputed
          ? state.disputedPointIds.filter((pointId) => pointId !== id)
          : [...state.disputedPointIds, id],
        confirmed: false,
        feedback: alreadyDisputed
          ? EXPERIMENTAL_COPY.disputeRemoved
          : EXPERIMENTAL_COPY.disputeAdded,
      };
    }),
  openEditor: (editor) =>
    set((state) => ({
      editor,
      draftText: state[editor],
      draftScore: state.score,
      selectedPointId: null,
      revealPointId: null,
    })),
  closeEditor: () => set({ editor: null }),
  setDraftText: (draftText) => set({ draftText }),
  setDraftScore: (draftScore) => set({ draftScore }),
  saveEdit: () =>
    set((state) => {
      if (!state.editor || !state.draftText.trim()) return state;

      return {
        [state.editor]: state.draftText.trim(),
        score: state.editor === 'verdict' ? state.draftScore : state.score,
        editor: null,
        confirmed: false,
        feedback: EXPERIMENTAL_COPY.editSaved,
      };
    }),
  confirmReview: () => set({ confirmed: true, feedback: EXPERIMENTAL_COPY.confirmed }),
  clearFeedback: () => set({ feedback: null }),
}));
