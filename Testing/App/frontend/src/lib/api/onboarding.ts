import { TIMINGS } from '@/config/constants';
import { sleep, apiFetch } from '@/lib/api/client';
import { invalidateResources } from '@/lib/cached-resource';

export interface OnboardingPayload {
  goal: string | null;
  level: string | null;
  dailyGoalMinutes: number | null;
  notificationsEnabled: boolean;
}

export interface BuildCourseResult {
  courseId: string;
  topicsCount: number;
}

// Лоадер «Строим курс…» — держим courseBuildMs, затем авто-переход.
export async function buildCourse(_payload: OnboardingPayload): Promise<BuildCourseResult> {
  await sleep(TIMINGS.courseBuildMs);

  // TODO: реальный расчёт курса на бэкенде по ответам пользователя (_payload).
  return { courseId: 'mock-course', topicsCount: 24 };
}

export async function saveOnboarding(payload: OnboardingPayload): Promise<void> {
  await apiFetch('/api/onboarding', {
    method: 'PATCH',
    json: {
      goalId: payload.goal,
      levelId: payload.level,
      dailyGoalMinutes: payload.dailyGoalMinutes,
      notificationsEnabled: payload.notificationsEnabled,
    },
  });
  invalidateResources();
}
