'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { DEMO_ACCOUNT, DEV_COPY, DEV_DEMO_TASK_PATH, DEV_SCREENS } from '@/config/dev';
import { DEV_TOOLS_ENABLED, IS_MOCK_API } from '@/config/env';
import { ROUTES } from '@/config/onboarding-steps';
import type { PlanId } from '@/config/plans';
import { useMockExamDemoControls } from '@/hooks/use-mock-exam-demo-controls';
import { loginUser } from '@/lib/api/auth';
import { changePlan } from '@/lib/api/billing';
import { normalizePlan } from '@/lib/plan';
import { useAuthStore } from '@/stores/auth-store';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useProfileStore } from '@/stores/profile-store';

export function useDevTools(onClose: () => void) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const resetOnboarding = useOnboardingStore((state) => state.reset);
  const resetProfile = useProfileStore((state) => state.reset);
  const mockExamDemo = useMockExamDemoControls();
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const go = (href: string) => {
    if (!DEV_TOOLS_ENABLED) return;
    if (!IS_MOCK_API && !DEV_SCREENS.some((screen) => screen.href === href)) return;
    onClose();
    router.push(href);
  };

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (!DEV_TOOLS_ENABLED || busy.current) return;
    busy.current = true;
    setPending(true);

    try {
      await action();
      setNote(done);
    } catch {
      setNote(DEV_COPY.actionFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const handleLogin = async () => {
    if (!IS_MOCK_API) return;
    await run(async () => {
      setUser(await loginUser(DEMO_ACCOUNT));
      go(ROUTES.home);
    }, DEV_COPY.loginDone);
  };

  const handlePlan = async (next: PlanId) => {
    if (!IS_MOCK_API || !user) return;
    await run(async () => setUser(await changePlan(next)), DEV_COPY.planDone);
  };

  const handleOpenMockExam = () => {
    if (!IS_MOCK_API || !DEV_TOOLS_ENABLED || busy.current) return;
    mockExamDemo.prepare();
    go(DEV_DEMO_TASK_PATH);
  };

  const handleResetMockExam = async () => {
    if (!IS_MOCK_API) return;
    await run(mockExamDemo.reset, DEV_COPY.resetMockExamDone);
  };

  const handleReset = () => {
    if (!DEV_TOOLS_ENABLED || busy.current) return;
    resetOnboarding();
    if (IS_MOCK_API) resetProfile();
    setNote(DEV_COPY.resetDone);
  };

  const handleLogout = async () => {
    if (user) await run(logout, DEV_COPY.logoutDone);
  };

  return {
    user,
    note,
    pending,
    plan: normalizePlan(user?.plan),
    go,
    handleLogin,
    handlePlan,
    handleReset,
    handleLogout,
    handleOpenMockExam,
    handleResetMockExam,
  };
}
