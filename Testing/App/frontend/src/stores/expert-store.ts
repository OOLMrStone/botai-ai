'use client';

import { create } from 'zustand';
import { updateExpertBlock, updateExpertFindings } from '@/lib/expert-causality';
import { rebaseExpertDrafts } from '@/lib/expert-drafts';
import {
  type ExpertAnalysis,
  type ExpertBlock,
  type ExpertQueueFilter,
  type ExpertQueueSort,
  type ExpertSession,
  type ExpertTask,
  type ExpertView,
  type ExpertWork,
  type ExpertWorkspaceData,
} from '@/config/expert';

interface ExpertState extends ExpertWorkspaceData {
  session: ExpertSession | null;
  sessionOwner: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  feedback: string | null;
  view: ExpertView;
  query: string;
  sort: ExpertQueueSort;
  filter: ExpertQueueFilter;
  selectedWorkId: string | null;
  selectedTaskId: string | null;
  drafts: Record<string, ExpertTask>;
  setSession: (session: ExpertSession | null) => void;
  setWorkspace: (workspace: ExpertWorkspaceData) => void;
  setLoading: (loading: boolean) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setFeedback: (feedback: string | null) => void;
  setView: (view: ExpertView) => void;
  setQuery: (query: string) => void;
  setSort: (sort: ExpertQueueSort) => void;
  setFilter: (filter: ExpertQueueFilter) => void;
  openWork: (id: string) => void;
  selectTask: (id: string) => void;
  updateBlock: (block: ExpertBlock) => void;
  updateAnalysis: (analysis: Partial<ExpertAnalysis>) => void;
  acceptWork: (work: ExpertWork, taskIds: string[]) => void;
  discardChanges: () => void;
  reset: () => void;
}

const initialState = {
  session: null,
  sessionOwner: null,
  loading: true,
  busy: false,
  error: null,
  feedback: null,
  view: 'queue' as ExpertView,
  query: '',
  sort: 'oldest' as ExpertQueueSort,
  filter: 'pending' as ExpertQueueFilter,
  students: [],
  works: [],
  selectedWorkId: null,
  selectedTaskId: null,
  drafts: {},
};

function selectedTask(state: ExpertState): ExpertTask | undefined {
  return state.selectedTaskId
    ? (state.drafts[state.selectedTaskId] ??
        state.works
          .find((work) => work.id === state.selectedWorkId)
          ?.tasks.find((task) => task.id === state.selectedTaskId))
    : undefined;
}

export const useExpertStore = create<ExpertState>((set) => ({
  ...initialState,
  setSession: (session) =>
    set((state) => {
      const owner = session ? `${session.mode}:${session.id}` : state.sessionOwner;
      if (session && owner !== state.sessionOwner) {
        return {
          ...initialState,
          session,
          sessionOwner: owner,
          loading: state.loading,
          busy: state.busy,
        };
      }

      return { session, sessionOwner: owner };
    }),
  setWorkspace: (workspace) =>
    set((state) => ({
      ...workspace,
      drafts: rebaseExpertDrafts(state.drafts, state.works, workspace.works),
    })),
  setLoading: (loading) => set({ loading }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setFeedback: (feedback) => set({ feedback }),
  setView: (view) => set({ view, error: null, feedback: null }),
  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setFilter: (filter) => set({ filter }),
  openWork: (id) =>
    set((state) => {
      const work = state.works.find((candidate) => candidate.id === id);
      if (!work) return state;

      return {
        selectedWorkId: id,
        selectedTaskId: work.tasks.find((task) => !task.approved)?.id ?? work.tasks[0]?.id ?? null,
        view: 'review',
        error: null,
        feedback: null,
      };
    }),
  selectTask: (id) =>
    set((state) =>
      state.works
        .find((work) => work.id === state.selectedWorkId)
        ?.tasks.some((task) => task.id === id)
        ? { selectedTaskId: id, error: null, feedback: null }
        : state,
    ),
  updateBlock: (block) =>
    set((state) => {
      const task = selectedTask(state);
      if (!task || task.readOnly || !task.blocks.some((current) => current.id === block.id))
        return state;
      const blocks = updateExpertBlock(task.blocks, structuredClone(block));
      const draft = {
        ...task,
        approved: false,
        updatedByExpert: true,
        analysis: {
          ...task.analysis,
          gradeStale: true,
          findings: updateExpertFindings(task.blocks, blocks, task.analysis.findings, block.id),
        },
        manualGradePending: false,
        blocks,
      };

      return { drafts: { ...state.drafts, [task.id]: draft }, error: null, feedback: null };
    }),
  updateAnalysis: (analysis) =>
    set((state) => {
      const task = selectedTask(state);
      if (!task || task.readOnly) return state;
      const draft = {
        ...task,
        approved: false,
        updatedByExpert: true,
        manualGradePending: 'score' in analysis,
        analysis: {
          ...task.analysis,
          ...structuredClone(analysis),
          ...('score' in analysis
            ? { hasGrade: true, rejectedReason: undefined, gradeStale: false }
            : { gradeStale: true }),
        },
      };

      return { drafts: { ...state.drafts, [task.id]: draft }, error: null, feedback: null };
    }),
  acceptWork: (work, taskIds) =>
    set((state) => ({
      works: state.works.map((current) => (current.id === work.id ? work : current)),
      drafts: Object.fromEntries(
        Object.entries(rebaseExpertDrafts(state.drafts, state.works, [work])).filter(
          ([id]) => !taskIds.includes(id),
        ),
      ),
    })),
  discardChanges: () =>
    set((state) => ({
      drafts: Object.fromEntries(
        Object.entries(state.drafts).filter(([id]) => id !== state.selectedTaskId),
      ),
      error: null,
      feedback: null,
    })),
  reset: () => set({ ...initialState, loading: false }),
}));
