'use client';

import { useRef } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';

import { LemurAlphaLayer } from '@/components/lemur/LemurAlphaLayer';
import { layout } from '@/config/layout';
import type { LemurAnimation } from '@/config/lemur-media';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface LemurVideoProps {
  animation: LemurAnimation;
  firstRef: RefObject<HTMLVideoElement | null>;
  secondRef: RefObject<HTMLVideoElement | null>;
  activeSlot: number;
  reactionBusy: boolean;
  onReact: () => void;
  error: string;
  className?: string;
  renderTarget?: HTMLElement | null;
  still?: boolean;
  preload?: 'auto' | 'none';
}

export function LemurVideo({
  animation,
  firstRef,
  secondRef,
  activeSlot,
  reactionBusy,
  onReact,
  error,
  className,
  renderTarget,
  still = false,
  preload = 'auto',
}: LemurVideoProps) {
  const reactionRef = useRef<HTMLButtonElement>(null);
  useGestureSurfaceGuard(reactionRef, { enabled: Boolean(animation.reaction) });
  const packed = animation.rendering === 'packed-alpha';
  const wide = animation.frameSize && animation.frameSize.width > animation.frameSize.height;
  const display = (
    <div
      className={cn(
        layout.lemurPreview.player,
        (animation.square || packed) && layout.lemurPreview.squarePlayer,
        className,
      )}
    >
      <div
        role={animation.reaction ? undefined : 'img'}
        aria-label={animation.label}
        className={cn(
          layout.lemurPreview.surface,
          animation.square && layout.lemurPreview.squareSurface,
          packed && (wide ? layout.embeddedBo.wideSurface : layout.embeddedBo.squareSurface),
        )}
      >
        {packed ? (
          <>
            <LemurAlphaLayer
              key={`first-${animation.frameSize?.width}-${animation.frameSize?.height}`}
              animation={animation}
              videoRef={firstRef}
              active={activeSlot === 0}
              still={still}
            />
            <LemurAlphaLayer
              key={`second-${animation.frameSize?.width}-${animation.frameSize?.height}`}
              animation={animation}
              videoRef={secondRef}
              active={activeSlot === 1}
              still={still}
            />
          </>
        ) : (
          <>
            <LemurVideoLayer
              animation={animation}
              videoRef={firstRef}
              active={activeSlot === 0}
              preload={preload}
            />
            <LemurVideoLayer
              animation={animation}
              videoRef={secondRef}
              active={activeSlot === 1}
              preload={preload}
            />
          </>
        )}
        {animation.reaction ? (
          <button
            ref={reactionRef}
            type="button"
            className={cn(layout.lemurPreview.reaction, layout.gestureSurface)}
            onClick={onReact}
            onContextMenu={preventGestureContextMenu}
            aria-label={animation.reaction.label}
            aria-disabled={reactionBusy}
          />
        ) : null}
      </div>
      {error ? (
        <p className={layout.lemurPreview.mediaError} role="status">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      {packed ? (
        <div className={layout.embeddedBo.sources} aria-hidden="true">
          <LemurVideoLayer
            animation={animation}
            videoRef={firstRef}
            active={false}
            preload={preload}
          />
          <LemurVideoLayer
            animation={animation}
            videoRef={secondRef}
            active={false}
            preload={preload}
          />
        </div>
      ) : null}
      {renderTarget === undefined
        ? display
        : renderTarget
          ? createPortal(display, renderTarget)
          : null}
    </>
  );
}

interface LemurVideoLayerProps {
  animation: LemurAnimation;
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  preload: 'auto' | 'none';
}

function LemurVideoLayer({ animation, videoRef, active, preload }: LemurVideoLayerProps) {
  return (
    <video
      ref={videoRef}
      poster={animation.rendering === 'packed-alpha' ? undefined : animation.poster}
      className={cn(
        layout.lemurPreview.video,
        layout.lemurPreview.videoLayer,
        !active && layout.lemurPreview.inactiveVideo,
      )}
      aria-hidden="true"
      muted
      playsInline
      preload={preload}
    />
  );
}
