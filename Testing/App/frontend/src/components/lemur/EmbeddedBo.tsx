'use client';

import { useImperativeHandle } from 'react';
import type { Ref } from 'react';

import { LemurVideo } from '@/components/lemur/LemurVideo';
import { EMBEDDED_BO_COPY } from '@/config/embedded-bo';
import { layout } from '@/config/layout';
import type { LemurAnimation } from '@/config/lemur-media';
import { useEmbeddedBo } from '@/hooks/use-embedded-bo';
import { cn } from '@/lib/utils';

export interface EmbeddedBoHandle {
  start: () => void;
}

interface EmbeddedBoProps {
  animation: LemurAnimation;
  className?: string;
  renderTarget?: HTMLElement | null;
  ref?: Ref<EmbeddedBoHandle>;
}

export function EmbeddedBo({ animation, className, renderTarget, ref }: EmbeddedBoProps) {
  const { setElement, ...player } = useEmbeddedBo(animation, renderTarget);
  useImperativeHandle(ref, () => ({ start: player.start }));

  return (
    <div
      ref={setElement}
      className={cn(
        renderTarget === undefined ? layout.embeddedBo.stage : layout.embeddedBo.sources,
        className,
      )}
    >
      <LemurVideo
        animation={animation}
        firstRef={player.firstRef}
        secondRef={player.secondRef}
        activeSlot={player.activeSlot}
        reactionBusy={player.reactionBusy || player.reducedMotion}
        onReact={player.react}
        error={player.error}
        preload={player.preload}
        renderTarget={renderTarget}
        still={player.reducedMotion}
      />
      {renderTarget === undefined && player.requiresInteraction && !player.reducedMotion ? (
        <button
          type="button"
          className={layout.embeddedBo.start}
          aria-label={EMBEDDED_BO_COPY.start}
          onClick={player.start}
        />
      ) : null}
    </div>
  );
}
