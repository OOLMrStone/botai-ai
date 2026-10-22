// Данные для тестирования приложения. Одно место и для мок-бэкенда (он заводит
// этот аккаунт), и для dev-панели (она им логинится).

import { MOCK_EXAM_DEMO } from '@/config/mock-exam-demo';
import { mockExamPath } from '@/config/mock-exams';
import { IS_MOCK_API } from '@/config/env';
import {
  ONBOARDING_STEPS,
  onboardingPath,
  REGISTER_STEPS,
  registerPath,
  ROUTES,
} from '@/config/onboarding-steps';

export const DEMO_ACCOUNT = {
  email: 'test@botai.ru',
  password: 'password123',
  displayName: 'Тест Тестов',
} as const;

// Тексты dev-панели. Живут отдельно от COPY: это инструмент разработчика,
// а не интерфейс продукта - в проде их не существует.
export const DEV_COPY = {
  title: 'Dev-панель',
  open: 'Открыть dev-панель',
  close: 'Закрыть',
  envTitle: 'Сборка',
  apiMock: 'мок API',
  apiReal: 'реальный бэкенд',
  accountTitle: 'Аккаунт',
  accountAnonymous: 'сессии нет',
  login: 'Войти тестовым',
  logout: 'Выйти',
  planTitle: 'Тариф',
  screensTitle: 'Экраны',
  resetTitle: 'Состояние',
  resetAction: IS_MOCK_API ? 'Сбросить онбординг и профиль' : 'Сбросить черновик онбординга',
  resetDone: IS_MOCK_API ? 'Сброшено' : 'Черновик онбординга сброшен',
  resetMockExamTitle: 'Пробник №1',
  resetMockExamAction: 'Сбросить пробник №1',
  openMockExamTask: 'Открыть задание 13',
  resetMockExamDone: 'Пробник №1 сброшен: ответы, фото, рисунки и результат удалены',
  loginDone: 'Вошли тестовым аккаунтом',
  logoutDone: 'Сессия закрыта',
  planDone: 'Тариф переключён',
  actionFailed: 'Не получилось выполнить действие',
} as const;

export interface DevScreen {
  label: string;
  href: string;
}

// Список экранов для быстрых прыжков. Выводится из тех же конфигов, что и сам
// флоу, - новый шаг появляется здесь сам.
const MOCK_ONLY_SCREENS = new Set<string>([ROUTES.lesson, ROUTES.streak]);

export const DEV_SCREENS: DevScreen[] = [
  ...ONBOARDING_STEPS.map((slug) => ({ label: slug, href: onboardingPath(slug) })),
  ...REGISTER_STEPS.map((slug) => ({ label: slug, href: registerPath(slug) })),
  ...Object.entries(ROUTES).map(([label, href]) => ({ label, href })),
].filter((screen) => IS_MOCK_API || !MOCK_ONLY_SCREENS.has(screen.href));

export const DEV_DEMO_TASK_PATH = `${mockExamPath(MOCK_EXAM_DEMO.examId)}?${MOCK_EXAM_DEMO.taskQueryKey}=${MOCK_EXAM_DEMO.taskNumber}`;
