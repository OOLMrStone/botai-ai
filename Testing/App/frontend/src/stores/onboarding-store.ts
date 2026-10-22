import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { EMPTY_REGISTRATION } from '@/config/auth';
import type { RegisterPayload } from '@/lib/api/auth';
import { restoreRegistration } from '@/lib/registration';
import { DEFAULT_DAILY_GOAL_MINUTES } from '@/config/onboarding-steps';
import { normalizeDailyGoalMinutes } from '@/lib/daily-goal';

export type RegistrationData = RegisterPayload;

interface OnboardingState {
  goal: string | null;
  level: string | null;
  dailyGoalMinutes: number | null;
  notificationsEnabled: boolean;
  hearAboutUs: string | null;
  registration: RegistrationData;
  needsProfileSave: boolean;
  requireProfileSave: () => void;

  setGoal: (goal: string) => void;
  setLevel: (level: string) => void;
  setDailyGoal: (minutes: number) => void;
  setNotifications: (enabled: boolean) => void;
  setHearAboutUs: (source: string) => void;
  updateRegistration: (data: Partial<RegistrationData>) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      goal: null,
      level: null,
      dailyGoalMinutes: DEFAULT_DAILY_GOAL_MINUTES,
      notificationsEnabled: false,
      hearAboutUs: null,
      registration: EMPTY_REGISTRATION,
      needsProfileSave: false,

      requireProfileSave: () => set({ needsProfileSave: true }),
      setGoal: (goal) => set({ goal }),
      setLevel: (level) => set({ level }),
      setDailyGoal: (dailyGoalMinutes) => set({ dailyGoalMinutes }),
      setNotifications: (notificationsEnabled) => set({ notificationsEnabled }),
      setHearAboutUs: (hearAboutUs) => set({ hearAboutUs }),
      updateRegistration: (data) =>
        set((state) => ({ registration: { ...state.registration, ...data } })),
      reset: () =>
        set({
          goal: null,
          level: null,
          dailyGoalMinutes: DEFAULT_DAILY_GOAL_MINUTES,
          notificationsEnabled: false,
          hearAboutUs: null,
          registration: EMPTY_REGISTRATION,
          needsProfileSave: false,
        }),
    }),
    {
      name: 'botai-onboarding',
      version: 3,
      partialize: (state) => ({
        ...state,
        registration: { ...state.registration, password: '' },
      }),
      migrate: (persisted) => {
        const saved = persisted as Partial<OnboardingState>;
        return {
          ...saved,
          dailyGoalMinutes:
            saved.dailyGoalMinutes === null || saved.dailyGoalMinutes === undefined
              ? DEFAULT_DAILY_GOAL_MINUTES
              : normalizeDailyGoalMinutes(saved.dailyGoalMinutes),
          registration: restoreRegistration(saved.registration),
        } as OnboardingState;
      },
      merge: (persisted, current) => {
        const saved = persisted as Partial<OnboardingState>;
        return {
          ...current,
          ...saved,
          registration: restoreRegistration(saved.registration),
        };
      },
    },
  ),
);
