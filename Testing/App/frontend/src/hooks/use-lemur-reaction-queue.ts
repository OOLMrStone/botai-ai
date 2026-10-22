'use client';

import { useEffect, useEffectEvent } from 'react';
import type { RefObject } from 'react';

import { LEMUR_PLAYBACK } from '@/config/lemur-copy';
import type { LemurAnimation } from '@/config/lemur-media';

export function useLemurReactionQueue(
  videoRef: RefObject<HTMLVideoElement | null>,
  queued: boolean,
  ready: boolean,
  reaction: LemurAnimation['reaction'],
  onReady: (mediaTime: number) => void,
) {
  const start = useEffectEvent(onReady);

  useEffect(() => {
    const video = videoRef.current;
    const period = reaction?.syncPeriod;
    if (!video || !queued || !ready || !period) return;

    const tolerance = reaction.syncTolerance ?? 0;
    const lateTolerance = tolerance * LEMUR_PLAYBACK.syncLateFrames;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    let frame: number;
    let previousTime = video.currentTime;
    let previousObservedAt = performance.now();

    const resetObservation = () => {
      previousTime = video.currentTime;
      previousObservedAt = performance.now();
    };

    const observe = (time: number) => {
      const observedAt = performance.now();
      const phase = time % period;
      const crossedSeam =
        Math.floor(time / period) > Math.floor(previousTime / period) ||
        (time < previousTime - lateTolerance && phase <= lateTolerance);
      const skippedCycle =
        ((observedAt - previousObservedAt) / 1000) * video.playbackRate >= period;

      previousTime = time;
      previousObservedAt = observedAt;

      // После пропущенного шва отвечаем на ближайшем доступном кадре,
      // иначе редкий callback может откладывать жест ещё на целый оборот.
      if (
        !video.paused &&
        !document.hidden &&
        (phase <= tolerance || period - phase <= tolerance || crossedSeam || skippedCycle)
      ) {
        start(time);
        return;
      }

      schedule();
    };
    const schedule = () => {
      frame = hasFrameCallback
        ? video.requestVideoFrameCallback((_, metadata) => observe(metadata.mediaTime))
        : requestAnimationFrame(() => observe(video.currentTime));
    };

    video.addEventListener('pause', resetObservation);
    video.addEventListener('playing', resetObservation);
    document.addEventListener('visibilitychange', resetObservation);
    schedule();
    return () => {
      if (hasFrameCallback) video.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      video.removeEventListener('pause', resetObservation);
      video.removeEventListener('playing', resetObservation);
      document.removeEventListener('visibilitychange', resetObservation);
    };
  }, [videoRef, queued, ready, reaction]);
}
