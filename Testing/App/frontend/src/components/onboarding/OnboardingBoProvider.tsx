'use client';

import type { ReactNode } from 'react';

import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';
import { OnboardingBoContext, useOnboardingBoStage } from '@/hooks/use-onboarding-bo';

export function OnboardingBoProvider({ children }: { children: ReactNode }) {
  const { playerRef, target, context } = useOnboardingBoStage();

  return (
    <OnboardingBoContext value={context}>
      <EmbeddedBo ref={playerRef} animation={LEMUR_ANIMATIONS.wave} renderTarget={target} />
      {children}
    </OnboardingBoContext>
  );
}
