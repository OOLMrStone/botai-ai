import { ClipboardCheck, Home, ListChecks, Sparkles, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';

import { COPY, ROUTES } from '@/config/onboarding-steps';

export interface AppTab {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  enabled?: boolean;
}

export const QUIZZES_ENABLED = false;

export const SESSION_COPY = {
  errorTitle: 'Не удалось подключиться',
  errorDescription: 'Проверь интернет или попробуй ещё раз чуть позже',
} as const;

// Состав и порядок вкладок нижней навигации - один источник правды.
export const APP_TABS: AppTab[] = [
  { href: ROUTES.home, label: COPY.nav.home, icon: Home },
  { href: ROUTES.quizzes, label: COPY.nav.quizzes, icon: Sparkles, enabled: QUIZZES_ENABLED },
  { href: ROUTES.tasks, label: COPY.nav.tasks, icon: ListChecks },
  { href: ROUTES.mockExams, label: COPY.nav.mockExams, icon: ClipboardCheck },
  { href: ROUTES.profile, label: COPY.nav.profile, icon: UserRound },
].filter((tab) => tab.enabled !== false);

export const LEARNING_COPY = {
  navigation: 'Учебные разделы',
  course: 'ЕГЭ · Профильная математика',
  storefront: 'На главную сайта',
  quizSoon: 'Квизы скоро появятся',
  quizDescription: 'Короткие задания для разминки и повторения теории',
  chooseTasks: 'Пока порешаем задачи',
} as const;
