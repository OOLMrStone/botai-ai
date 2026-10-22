'use client';

import { LemurVideo } from '@/components/lemur/LemurVideo';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import type { LemurAnimation } from '@/config/lemur-media';
import { useLemurPreview } from '@/hooks/use-lemur-preview';

interface LemurPreviewProps {
  animation: LemurAnimation;
}

export function LemurPreview({ animation }: LemurPreviewProps) {
  const {
    firstRef,
    secondRef,
    activeSlot,
    error,
    reactionBusy,
    subtitle,
    react,
    pauseLabel,
    speedLabel,
    togglePause,
    toggleSpeed,
  } = useLemurPreview(animation);

  return (
    <main className={layout.lemurPreview.root}>
      <ScreenShell
        center
        className={layout.lemurPreview.shell}
        footer={
          <div className={layout.lemurPreview.controls}>
            <Button className={layout.lemurPreview.button} onClick={togglePause}>
              {pauseLabel}
            </Button>
            <Button
              variant="secondary"
              className={layout.lemurPreview.button}
              onClick={toggleSpeed}
            >
              {speedLabel}
            </Button>
          </div>
        }
      >
        <ScreenHeading title={animation.title} subtitle={subtitle} />
        <div className={layout.lemurPreview.stage}>
          <LemurVideo
            animation={animation}
            firstRef={firstRef}
            secondRef={secondRef}
            activeSlot={activeSlot}
            reactionBusy={reactionBusy}
            onReact={react}
            error={error}
            className={layout.lemurPreview.character}
          />
        </div>
      </ScreenShell>
    </main>
  );
}
