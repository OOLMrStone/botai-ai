'use client';

import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

import { OnboardingMascot } from '@/components/onboarding/OnboardingMascot';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { TIMINGS } from '@/config/constants';
import { MOTION_STYLES } from '@/config/motion';
import { cn } from '@/lib/utils';

interface BuildingLoaderProps {
  title: string;
  subtitle?: string;
  onDone: () => void;
  durationMs?: number;
}

// Лоадер «Строим курс…»: держит экран, затем авто-переход через onDone.
export function BuildingLoader({
  title,
  subtitle,
  onDone,
  durationMs = TIMINGS.courseBuildMs,
}: BuildingLoaderProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [onDone, durationMs]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <OnboardingMascot />

      <ScreenHeading title={title} subtitle={subtitle} />

      <Loader2 className={cn('text-muted-foreground size-6', MOTION_STYLES.loadingSpin)} />
    </div>
  );
}
