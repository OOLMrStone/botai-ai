'use client';

import { useEffect, useEffectEvent } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';

import { LEMUR_PLAYBACK } from '@/config/lemur-copy';
import type { LemurAnimation } from '@/config/lemur-media';

export function useLemurSeamlessLoop(
  videoRef: RefObject<HTMLVideoElement | null>,
  activeSlot: number,
  timing: LemurAnimation['seamlessLoop'],
  enabled: boolean,
  playbackRate: number,
  preparedVideo: () => HTMLVideoElement | null,
  onLoop: () => boolean,
) {
  const advance = useEffectEvent(onLoop);
  const prepared = useEffectEvent(preparedVideo);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !timing || !enabled) return;

    const frameDuration = 1 / timing.fps;
    const nativeCallback = typeof video.requestVideoFrameCallback === 'function';
    let frame: number | null = null;
    let warmFrame: number | null = null;
    let kickoff: number | null = null;
    let alignment: number | null = null;
    let settling = 0;
    let next: HTMLVideoElement | null = null;
    let displayedTime = video.currentTime;
    let displayedAt = 0;
    let warmed: { time: number; now: number } | null = null;
    const active = () => videoRef.current === video && !video.paused && !document.hidden;
    const cancelFrame = (target: HTMLVideoElement, id: number) => {
      if (nativeCallback) target.cancelVideoFrameCallback(id);
      else cancelAnimationFrame(id);
    };
    const requestFrame = (target: HTMLVideoElement, callback: VideoFrameRequestCallback) =>
      nativeCallback
        ? target.requestVideoFrameCallback(callback)
        : requestAnimationFrame((now) =>
            callback(now, { mediaTime: target.currentTime } as VideoFrameCallbackMetadata),
          );
    const tryAdvance = () => {
      if (!next || !warmed) return false;
      const difference = warmed.time - (displayedTime - timing.duration);
      const elapsed = warmed.now - displayedAt;
      if (
        displayedTime >= timing.duration &&
        Math.abs(difference) < frameDuration / 2 &&
        Math.abs(elapsed) < (frameDuration * 1000) / 2
      ) {
        if (next.playbackRate !== playbackRate) {
          next.playbackRate = playbackRate;
          settling = LEMUR_PLAYBACK.loopSettleFrames;
          return false;
        }
        if (settling > 0) return false;
        // Оба canvas уже показывают одну фазу; переключение не ждёт cold-start play.
        let advanced = false;
        flushSync(() => {
          advanced = advance();
        });
        return advanced;
      }
      return false;
    };
    const align = () => {
      alignment = null;
      if (!active() || !next || !warmed || tryAdvance() || settling > 0) return;
      // RAF собирает оба callback прошлого paint, независимо от порядка video.
      const difference = warmed.time - (displayedTime - timing.duration);
      const elapsed = warmed.now - displayedAt;
      const clockDifference = difference - (elapsed * playbackRate) / 1000;
      const rate =
        playbackRate * (1 - Math.sign(clockDifference) * LEMUR_PLAYBACK.loopAlignmentRate);
      if (next.playbackRate !== rate) next.playbackRate = rate;
    };
    const warmTick = (now: number, metadata: VideoFrameCallbackMetadata) => {
      warmFrame = null;
      if (!active() || !next) return;
      if (settling > 0 && warmed && metadata.mediaTime > warmed.time) settling--;
      warmed = { time: metadata.mediaTime, now };
      if (tryAdvance()) return;
      if (alignment === null) alignment = requestAnimationFrame(align);
      warmFrame = requestFrame(next, warmTick);
    };
    const beginOverlap = () => {
      kickoff = null;
      if (!active()) return;
      if (video.currentTime < timing.duration) {
        kickoff = requestAnimationFrame(beginOverlap);
        return;
      }
      next = prepared();
      if (!next) {
        kickoff = requestAnimationFrame(beginOverlap);
        return;
      }
      next.loop = false;
      next.playbackRate = playbackRate;
      const phase = video.currentTime - timing.duration;
      if (Math.abs(next.currentTime - phase) > frameDuration) next.currentTime = phase;
      settling = LEMUR_PLAYBACK.loopSettleFrames;
      warmFrame = requestFrame(next, warmTick);
      void next.play().catch(() => {
        if (warmFrame !== null && next) cancelFrame(next, warmFrame);
        warmFrame = null;
      });
    };
    const tick = (now: number, metadata: VideoFrameCallbackMetadata) => {
      frame = null;
      if (!active()) return;
      displayedTime = metadata.mediaTime;
      displayedAt = now;
      if (tryAdvance()) return;
      if (!next && kickoff === null && displayedTime >= timing.duration - frameDuration) {
        kickoff = requestAnimationFrame(beginOverlap);
      }
      frame = requestFrame(video, tick);
    };
    const stop = () => {
      if (frame !== null) cancelFrame(video, frame);
      if (warmFrame !== null && next) cancelFrame(next, warmFrame);
      if (kickoff !== null) cancelAnimationFrame(kickoff);
      if (alignment !== null) cancelAnimationFrame(alignment);
      if (next && videoRef.current !== next) next.pause();
      frame = null;
      warmFrame = null;
      kickoff = null;
      alignment = null;
      settling = 0;
      next = null;
      warmed = null;
    };
    const sync = () => {
      stop();
      if (active()) frame = requestFrame(video, tick);
    };

    video.addEventListener('playing', sync);
    video.addEventListener('pause', stop);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      stop();
      video.removeEventListener('playing', sync);
      video.removeEventListener('pause', stop);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [videoRef, activeSlot, timing, enabled, playbackRate]);
}
