import { History, Settings } from 'lucide-react';

import { LEARNING_COPY, LEARNING_ROUTES } from '@/config/integration';
import { COPY, ROUTES } from '@/config/onboarding-steps';

export const PROFILE_COPY = {
  photo: 'Фото профиля',
  joined: (date: string) => `Ботаешь с ${date}`,
  goalUnset: 'Выбери цель',
  historyHint: 'Подборки, ответы и результаты',
  settingsHint: 'Фото, имя и цели',
  choose: 'Выбрать',
  level: 'Уровень подготовки',
} as const;

export const PROFILE_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const PROFILE_DATE_SUFFIX = /\s*г\.$/u;

export const PROFILE_AVATAR = { size: 128 } as const;

export const PROFILE_LINKS = [
  {
    href: LEARNING_ROUTES.history,
    title: LEARNING_COPY.history,
    hint: PROFILE_COPY.historyHint,
    icon: History,
  },
  {
    href: ROUTES.settings,
    title: COPY.profile.settingsRow,
    hint: PROFILE_COPY.settingsHint,
    icon: Settings,
  },
] as const;
