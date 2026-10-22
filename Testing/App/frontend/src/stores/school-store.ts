'use client';

import { create } from 'zustand';
import { SCHOOL } from '@/config/school';
import type {
  SchoolAssignment,
  SchoolAssignmentSummary,
  SchoolIdentity,
  SchoolSubmission,
  SchoolTaskNumber,
} from '@/lib/api/school-types';

type SchoolFilter = SchoolTaskNumber | typeof SCHOOL.allNumbers;

interface SchoolState {
  session: SchoolIdentity | null;
  sessionResolved: boolean;
  assignments: SchoolAssignmentSummary[];
  assignment: SchoolAssignment | null;
  filter: SchoolFilter;
  loading: boolean;
  opening: boolean;
  busy: boolean;
  error: string | null;
  setSession: (session: SchoolIdentity | null) => void;
  setAssignments: (assignments: SchoolAssignmentSummary[]) => void;
  setAssignment: (assignment: SchoolAssignment | null) => void;
  acceptSubmission: (submission: SchoolSubmission) => void;
  setFilter: (filter: SchoolFilter) => void;
  setLoading: (loading: boolean) => void;
  setOpening: (opening: boolean) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  session: null,
  sessionResolved: false,
  assignments: [],
  assignment: null,
  filter: SCHOOL.allNumbers,
  loading: true,
  opening: false,
  busy: false,
  error: null,
};

export const useSchoolStore = create<SchoolState>((set) => ({
  ...initialState,
  setSession: (session) =>
    set((state) =>
      state.session?.id === session?.id
        ? { session, sessionResolved: true }
        : { ...initialState, session, sessionResolved: true, loading: false },
    ),
  setAssignments: (assignments) => set({ assignments }),
  setAssignment: (assignment) => set({ assignment }),
  acceptSubmission: (submission) =>
    set((state) => {
      const previous = state.assignment?.submission;
      if (previous?.assignmentId === submission.assignmentId) {
        if (previous.id !== submission.id && previous.createdAt > submission.createdAt)
          return state;
        if (previous.id === submission.id && previous.revision > submission.revision) return state;
        if (previous.id === submission.id && previous.updatedAt > submission.updatedAt)
          return state;
      }
      const summary = {
        submissionId: submission.id,
        status: submission.status,
        updatedAt: submission.updatedAt,
      };
      return {
        assignments: state.assignments.map((assignment) =>
          assignment.id === submission.assignmentId ? { ...assignment, ...summary } : assignment,
        ),
        assignment:
          state.assignment?.id === submission.assignmentId
            ? {
                ...state.assignment,
                ...summary,
                submission,
                fixtureAttachmentIncomplete:
                  previous?.id === submission.id
                    ? state.assignment.fixtureAttachmentIncomplete
                    : false,
                history: [
                  submission,
                  ...(state.assignment.history ?? (previous ? [previous] : [])).filter(
                    (item) => item.id !== submission.id,
                  ),
                ],
              }
            : state.assignment,
      };
    }),
  setFilter: (filter) => set({ filter }),
  setLoading: (loading) => set({ loading }),
  setOpening: (opening) => set({ opening }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  reset: () => set({ ...initialState, sessionResolved: true, loading: false }),
}));
