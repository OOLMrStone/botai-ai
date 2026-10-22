'use client';

import { createContext, useContext, useRef, useState } from 'react';

interface BoPlayback {
  start: () => void;
}

interface OnboardingBoContextValue {
  start: () => void;
  attach: (element: HTMLDivElement | null) => void;
}

export const OnboardingBoContext = createContext<OnboardingBoContextValue | null>(null);

export function useOnboardingBoStage() {
  const playerRef = useRef<BoPlayback>(null);
  const [target, attach] = useState<HTMLDivElement | null>(null);

  function start() {
    playerRef.current?.start();
  }

  return { playerRef, target, context: { start, attach } };
}

export function useOnboardingBo() {
  const context = useContext(OnboardingBoContext);
  if (!context) throw new Error('OnboardingBoProvider is missing');
  return context;
}
