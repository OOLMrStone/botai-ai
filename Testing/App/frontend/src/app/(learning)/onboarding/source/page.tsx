'use client';

import { QuestionScreen } from '@/components/onboarding/QuestionScreen';
import { COPY, SOURCE_OPTIONS } from '@/config/onboarding-steps';
import { useOnboardingFlow } from '@/hooks/use-flow-navigation';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function SourcePage() {
  const { goNext } = useOnboardingFlow('source');
  const hearAboutUs = useOnboardingStore((s) => s.hearAboutUs);
  const setHearAboutUs = useOnboardingStore((s) => s.setHearAboutUs);

  return (
    <QuestionScreen
      title={COPY.source.title}
      subtitle={COPY.source.subtitle}
      options={SOURCE_OPTIONS}
      value={hearAboutUs}
      onValueChange={setHearAboutUs}
      actionLabel={COPY.source.action}
      onContinue={() => goNext()}
    />
  );
}
