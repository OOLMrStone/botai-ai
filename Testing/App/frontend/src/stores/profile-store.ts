import { create } from 'zustand';
interface ProfileState {
  name: string | null;
  goalId: string | null;
  dailyGoalMinutes: number | null;
  update: (patch: Partial<Pick<ProfileState, 'name' | 'goalId' | 'dailyGoalMinutes'>>) => void;
  reset: () => void;
}
export const useProfileStore = create<ProfileState>()((set) => ({
  name: null,
  goalId: null,
  dailyGoalMinutes: null,
  update: (patch) => set(patch),
  reset: () => set({ name: null, goalId: null, dailyGoalMinutes: null }),
}));
