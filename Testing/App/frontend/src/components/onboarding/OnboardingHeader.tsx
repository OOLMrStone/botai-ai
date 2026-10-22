'use client';

import { ChevronLeft } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useFlowHeader } from '@/hooks/use-flow-header';

interface OnboardingHeaderProps {
  steps: readonly string[];
}

// Стрелка «назад» + прогресс-бар. Живёт в layout, текущий шаг берёт из pathname.
export function OnboardingHeader({ steps }: OnboardingHeaderProps) {
  const { progress, goBack } = useFlowHeader(steps);

  if (!progress) return null;

  return (
    <header className={layout.flowHeader.root}>
      <button
        type="button"
        onClick={goBack}
        aria-label={COPY.nav.back}
        className={layout.flowHeader.back}
      >
        <ChevronLeft className={layout.flowHeader.icon} />
      </button>

      <Progress value={progress.value} max={progress.max} className={layout.flowHeader.progress} />
      <span aria-hidden="true" />
    </header>
  );
}
