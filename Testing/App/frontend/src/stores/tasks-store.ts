'use client';

import { create } from 'zustand';

import {
  DEFAULT_TRAINING_SETTINGS,
  type DrawingStroke,
  type TaskHistoryStatus,
  type TaskStatus,
  type TrainingSettings,
  type TrainingTask,
} from '@/config/tasks';
import { checkTrainingAnswers } from '@/lib/task-training';

export type TasksView = 'part-1' | 'part-2' | 'favorites';
export interface TrainingSession {
  id: string;
  taskIds: string[];
  currentIndex: number;
  answers: Record<string, string>;
  statuses: Record<string, TaskStatus>;
  revealedSolutions: string[];
  source: 'catalog' | 'favorites';
}

interface TasksState {
  hydrate: (items: { id: string; drawing: DrawingStroke[] }[]) => void;
  acknowledge: (id: string, strokes: DrawingStroke[]) => void;
  reset: () => void;

  view: TasksView;
  catalogScrollTop: number;
  setupTaskIds: string[];
  setupSource: TrainingSession['source'];
  setupExamNumber: number | null;
  favorites: string[];
  history: Record<string, TaskHistoryStatus>;
  solvedAt: Record<string, string>;
  settings: TrainingSettings;
  session: TrainingSession | null;
  drawings: Record<string, DrawingStroke[]>;
  savedDrawings: Record<string, DrawingStroke[]>;
  editingDrawings: Record<string, boolean>;
  setView: (view: TasksView) => void;
  setCatalogScrollTop: (scrollTop: number) => void;
  requestSetup: () => void;
  openSetup: (
    tasks: TrainingTask[],
    source: TrainingSession['source'],
    examNumber?: number,
  ) => void;
  toggleFavorite: (taskId: string) => void;
  setFavorites: (taskIds: string[]) => void;
  setSettings: (settings: TrainingSettings) => void;
  startSession: (tasks: TrainingTask[], source: TrainingSession['source']) => void;
  setCurrentIndex: (index: number) => void;
  setAnswer: (taskId: string, answer: string) => void;
  checkAnswers: (tasks: TrainingTask[]) => void;
  toggleSolution: (taskId: string) => void;
  finishSession: () => void;
  removeCorrectFavorites: () => void;
  setDrawing: (taskId: string, strokes: DrawingStroke[]) => void;
  commitDrawing: (taskId: string) => void;
  finishDrawingGesture: (taskId: string) => void;
  markInProgress: (taskId: string) => void;
  prepareSessionExit: () => void;
  resetTaskProgress: (taskIds: string[]) => void;
}

export const useTasksStore = create<TasksState>()((set, get) => ({
  hydrate: (items) =>
    set((state) => ({
      drawings: {
        ...state.drawings,
        ...Object.fromEntries(
          items
            .filter(
              (item) =>
                !Object.hasOwn(state.savedDrawings, item.id) && !state.editingDrawings[item.id],
            )
            .map((item) => [item.id, item.drawing ?? []]),
        ),
      },
    })),
  acknowledge: (id, strokes) =>
    set((state) => {
      if (state.savedDrawings[id] !== strokes) return state;
      const savedDrawings = { ...state.savedDrawings };
      delete savedDrawings[id];
      return { savedDrawings };
    }),
  reset: () =>
    set({
      view: 'part-1',
      catalogScrollTop: 0,
      favorites: [],
      history: {},
      solvedAt: {},
      session: null,
      setupTaskIds: [],
      setupExamNumber: null,
      drawings: {},
      savedDrawings: {},
      editingDrawings: {},
    }),
  view: 'part-1',
  catalogScrollTop: 0,
  setupTaskIds: [],
  setupSource: 'catalog',
  setupExamNumber: null,
  favorites: [],
  history: {},
  solvedAt: {},
  settings: DEFAULT_TRAINING_SETTINGS,
  session: null,
  drawings: {},
  savedDrawings: {},
  editingDrawings: {},
  setView: (view) => set({ view }),
  setCatalogScrollTop: (catalogScrollTop) => set({ catalogScrollTop }),
  openSetup: (tasks, source, examNumber) =>
    set({
      setupTaskIds: tasks.map((task) => task.id),
      setupSource: source,
      setupExamNumber: examNumber ?? null,
    }),
  requestSetup: () =>
    set((state) => {
      const session = state.session;
      if (!session) return state;

      const retainedTarget =
        state.setupSource === session.source &&
        session.taskIds.every((id) => state.setupTaskIds.includes(id));

      return {
        setupTaskIds: retainedTarget ? state.setupTaskIds : session.taskIds,
        setupSource: session.source,
        setupExamNumber: retainedTarget ? state.setupExamNumber : null,
        session: null,
      };
    }),
  toggleFavorite: (taskId) =>
    set((state) => ({
      favorites: state.favorites.includes(taskId)
        ? state.favorites.filter((id) => id !== taskId)
        : [taskId, ...state.favorites],
    })),
  setFavorites: (favorites) => set({ favorites }),
  setSettings: (settings) => set({ settings }),
  startSession: (tasks, source) =>
    set((state) => {
      const drawings = { ...state.drawings };
      for (const task of tasks) {
        const saved = state.savedDrawings[task.id];
        if (state.history[task.id] === 'correct') delete drawings[task.id];
        else if (saved) drawings[task.id] = saved;
      }

      return {
        session: {
          id: `${Date.now()}`,
          taskIds: tasks.map((task) => task.id),
          currentIndex: 0,
          answers: {},
          statuses: {},
          revealedSolutions: [],
          source,
        },
        drawings,
      };
    }),
  setCurrentIndex: (currentIndex) =>
    set((state) => ({ session: state.session ? { ...state.session, currentIndex } : null })),
  setAnswer: (taskId, answer) =>
    set((state) =>
      state.session
        ? {
            history:
              state.history[taskId] === 'correct'
                ? state.history
                : { ...state.history, [taskId]: 'in-progress' },
            session: {
              ...state.session,
              answers: { ...state.session.answers, [taskId]: answer },
              statuses: { ...state.session.statuses, [taskId]: 'unverified' },
            },
          }
        : state,
    ),
  checkAnswers: (tasks) => {
    const session = get().session;
    if (!session) return;

    const { statuses, history } = checkTrainingAnswers({
      taskIds: session.taskIds,
      answers: session.answers,
      statuses: session.statuses,
      history: get().history,
      tasks,
    });

    const solvedIds = session.taskIds.filter((taskId) => statuses[taskId] === 'correct');
    const solvedAt = { ...get().solvedAt };
    const drawings = { ...get().drawings };
    const savedDrawings = { ...get().savedDrawings };
    const checkedAt = new Date().toISOString();
    for (const taskId of solvedIds) {
      solvedAt[taskId] = checkedAt;
      delete drawings[taskId];
      delete savedDrawings[taskId];
    }

    set({
      session: { ...session, statuses, currentIndex: 0 },
      history,
      solvedAt,
      drawings,
      savedDrawings,
    });
  },
  toggleSolution: (taskId) =>
    set((state) => {
      if (!state.session) return state;
      const shown = state.session.revealedSolutions.includes(taskId);
      return {
        session: {
          ...state.session,
          revealedSolutions: shown
            ? state.session.revealedSolutions.filter((id) => id !== taskId)
            : [...state.session.revealedSolutions, taskId],
        },
      };
    }),
  finishSession: () => set({ session: null }),
  removeCorrectFavorites: () =>
    set((state) => {
      if (!state.session) return state;
      const correct = new Set(
        state.session.taskIds.filter((taskId) => state.session?.statuses[taskId] === 'correct'),
      );
      return { favorites: state.favorites.filter((taskId) => !correct.has(taskId)) };
    }),
  setDrawing: (taskId, strokes) =>
    set((state) => ({
      drawings: { ...state.drawings, [taskId]: strokes },
      editingDrawings: { ...state.editingDrawings, [taskId]: true },
    })),
  commitDrawing: (taskId) =>
    set((state) => {
      const strokes = state.drawings[taskId];
      if (!strokes || state.history[taskId] === 'correct') return state;
      const savedDrawings = { ...state.savedDrawings };
      savedDrawings[taskId] = strokes;
      const editingDrawings = { ...state.editingDrawings };
      delete editingDrawings[taskId];
      return { savedDrawings, editingDrawings };
    }),
  finishDrawingGesture: (taskId) =>
    set((state) => {
      const editingDrawings = { ...state.editingDrawings };
      delete editingDrawings[taskId];
      return { editingDrawings };
    }),
  markInProgress: (taskId) =>
    set((state) =>
      state.history[taskId] === 'correct'
        ? state
        : { history: { ...state.history, [taskId]: 'in-progress' } },
    ),
  resetTaskProgress: (taskIds) =>
    set((state) => {
      const history = { ...state.history };
      const solvedAt = { ...state.solvedAt };
      const drawings = { ...state.drawings };
      const savedDrawings = { ...state.savedDrawings };
      const editingDrawings = { ...state.editingDrawings };

      for (const taskId of taskIds) {
        delete history[taskId];
        delete solvedAt[taskId];
        delete drawings[taskId];
        delete savedDrawings[taskId];
        delete editingDrawings[taskId];
      }

      return { history, solvedAt, drawings, savedDrawings, editingDrawings };
    }),
  prepareSessionExit: () =>
    set((state) => {
      if (!state.session) return state;
      const history = { ...state.history };
      const drawings = { ...state.drawings };
      const savedDrawings = { ...state.savedDrawings };
      const statuses: Record<string, TaskStatus> = {};

      for (const taskId of state.session.taskIds) {
        const correct =
          state.session.statuses[taskId] === 'correct' || history[taskId] === 'correct';
        if (correct) {
          if (state.session.statuses[taskId] === 'correct') statuses[taskId] = 'correct';
          delete drawings[taskId];
          delete savedDrawings[taskId];
          continue;
        }

        const started =
          Boolean(state.session.answers[taskId]?.trim()) ||
          Boolean(state.drawings[taskId]?.length) ||
          state.session.statuses[taskId] === 'incorrect';
        if (started && history[taskId] !== 'correct') history[taskId] = 'in-progress';
        if (state.drawings[taskId]?.length) savedDrawings[taskId] = state.drawings[taskId];
      }

      return {
        history,
        drawings,
        savedDrawings,
        session: { ...state.session, answers: {}, statuses },
      };
    }),
}));
