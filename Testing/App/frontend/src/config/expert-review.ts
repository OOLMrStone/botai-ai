import { Check, CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { EXPERT_COPY } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';

export const EXPERT_REVIEW_COPY = {
  reset: 'Сбросить изменения',
  rejectHint: 'Ученику будет отправлена причина отказа без оценки',
} as const;

export const EXPERT_REVIEW_ACTIONS = {
  findings: { label: 'Проверить замечания', icon: CircleAlert },
  grade: { label: EXPERT_UI_COPY.grade, icon: Sparkles },
  queued: { label: EXPERT_COPY.gradeWaiting, icon: LoaderCircle },
  pending: { label: EXPERT_UI_COPY.grading, icon: LoaderCircle },
  refresh: { label: EXPERT_UI_COPY.refreshGrade, icon: RefreshCw },
  confirm: { label: EXPERT_COPY.confirm, icon: Check },
  reject: { label: EXPERT_UI_COPY.confirmRejection, icon: Check },
  approved: { label: 'Проверено', icon: Check },
} as const;

export const EXPERT_REVIEW_SCROLL = { top: 0, left: 0, behavior: 'instant' } as const;
