'use client';

import { layout } from '@/config/layout';
import { useOnboardingBo } from '@/hooks/use-onboarding-bo';

// Меняется только место вывода: подготовленные video остаются в layout между шагами.
export function IntroBo() {
  const { attach } = useOnboardingBo();

  return <div ref={attach} className={layout.embeddedBo.stage} />;
}
