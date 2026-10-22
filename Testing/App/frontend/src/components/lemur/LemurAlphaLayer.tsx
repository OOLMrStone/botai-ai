'use client';

import Image from 'next/image';
import type { RefObject } from 'react';

import { EMBEDDED_BO } from '@/config/embedded-bo';
import { layout } from '@/config/layout';
import type { LemurAnimation } from '@/config/lemur-media';
import { useLemurAlphaFrame } from '@/hooks/use-lemur-alpha-frame';
import { cn } from '@/lib/utils';

interface LemurAlphaLayerProps {
  animation: LemurAnimation;
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  still: boolean;
}

export function LemurAlphaLayer({ animation, videoRef, active, still }: LemurAlphaLayerProps) {
  const { canvasRef, presented } = useLemurAlphaFrame(videoRef, !still);
  const showFrame = presented && !still;
  const size = animation.frameSize ?? EMBEDDED_BO.alpha;

  return (
    <div className={cn(layout.embeddedBo.layer, !active && layout.lemurPreview.inactiveVideo)}>
      <Image
        src={animation.poster}
        alt=""
        width={size.width}
        height={size.height}
        loading="eager"
        unoptimized
        className={cn(layout.embeddedBo.layer, showFrame && layout.lemurPreview.inactiveVideo)}
      />
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        aria-hidden="true"
        className={cn(layout.embeddedBo.layer, !showFrame && layout.lemurPreview.inactiveVideo)}
      />
    </div>
  );
}
