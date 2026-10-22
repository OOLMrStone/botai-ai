'use client';

import { useEffect, useEffectEvent, useState } from 'react';

import { LEMUR_COPY, LEMUR_PLAYBACK } from '@/config/lemur-copy';
import type { LemurAnimation } from '@/config/lemur-media';
import { useLemurSeamlessLoop } from '@/hooks/use-lemur-seamless-loop';
import { useLemurVideoBuffer } from '@/hooks/use-lemur-video-buffer';
import type { LemurVideoRequest } from '@/hooks/use-lemur-video-buffer';
import { prepareLemurVideo } from '@/lib/lemur-video-source';

interface LemurVideoOptions extends LemurVideoRequest {
  prepared?: LemurVideoRequest;
  paused: boolean;
  playbackRate: number;
  loop: boolean;
  loopFrom?: number;
  seamlessLoop?: LemurAnimation['seamlessLoop'];
  onFinish?: () => void;
  onError?: (message: string) => void;
  deferLoad?: boolean;
}

export function useLemurVideo({
  source,
  startAt,
  prepared,
  paused,
  playbackRate,
  loop,
  loopFrom,
  seamlessLoop,
  onFinish,
  onError,
  deferLoad = false,
}: LemurVideoOptions) {
  const [requested, setRequested] = useState(false);
  const [failure, setFailure] = useState({ source, message: '' });
  const [ended, setEnded] = useState(false);
  const [blockedSource, setBlockedSource] = useState<string | null>(null);
  const requiresInteraction = blockedSource === source;
  const error = failure.source === source ? failure.message : '';
  const bufferedLoop = loop && Boolean(seamlessLoop) && !prepared;
  const nativeLoop = loop && !seamlessLoop;
  const buffer = useLemurVideoBuffer({
    enabled: !deferLoad || requested,
    source,
    startAt,
    prepared: prepared ?? (bufferedLoop ? { source, startAt: LEMUR_PLAYBACK.start } : undefined),
    onReady: () => {
      setEnded(false);
      setFailure({ source, message: '' });
    },
    onError: (message) => {
      setFailure({ source, message });
      onError?.(message);
    },
  });
  const { ref, firstRef, secondRef, activeSlot, ready } = buffer;
  const finishReaction = useEffectEvent(() => {
    if (!onFinish) return false;
    onFinish();
    return true;
  });
  const reportFailure = useEffectEvent((message: string) => {
    setFailure({ source, message });
    onError?.(message);
  });
  function isCurrent(video: HTMLVideoElement) {
    return (
      video === (buffer.pendingRef.current ?? ref.current) &&
      (video === buffer.firstRef.current || video === buffer.secondRef.current) &&
      video.getAttribute('src') === source
    );
  }

  function play(video: HTMLVideoElement) {
    if (document.hidden) return;

    video.playbackRate = playbackRate;
    video.loop = nativeLoop;
    void video
      .play()
      .then(() => {
        if (!isCurrent(video)) return;
        setBlockedSource(null);
        setFailure({ source, message: '' });
      })
      .catch((reason: unknown) => {
        if (!isCurrent(video) || (reason instanceof DOMException && reason.name === 'AbortError')) {
          return;
        }

        setBlockedSource(source);
        if (reason instanceof DOMException && reason.name === 'NotAllowedError') return;
        setFailure({ source, message: LEMUR_COPY.playError });
        onError?.(LEMUR_COPY.playError);
      });
  }
  const playAutomatically = useEffectEvent(play);
  function advanceLoop() {
    const next = buffer.advanceLoop();
    if (!next) return false;
    next.playbackRate = playbackRate;
    if (next.paused) play(next);
    return true;
  }
  useLemurSeamlessLoop(
    ref,
    activeSlot,
    seamlessLoop,
    bufferedLoop && ready && !paused && !ended && !requiresInteraction,
    playbackRate,
    buffer.preparedLoopVideo,
    advanceLoop,
  );

  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;

    return () => {
      first?.pause();
      second?.pause();
    };
  }, [firstRef, secondRef]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const sync = () => {
      video.playbackRate = playbackRate;
      video.loop = nativeLoop;
      if (!ready || requiresInteraction || paused || ended || video.ended || document.hidden) {
        video.pause();
        return;
      }
      if (video.paused) playAutomatically(video);
    };
    const fail = () => reportFailure(LEMUR_COPY.loadError);
    const finish = () => {
      if (!ready || finishReaction()) return;
      if (loop && seamlessLoop) {
        video.currentTime = seamlessLoop.overlap;
        sync();
        return;
      }
      if (loopFrom === undefined) {
        setEnded(true);
        return;
      }

      video.currentTime = loopFrom;
      sync();
    };

    sync();
    video.addEventListener('canplay', sync);
    video.addEventListener('error', fail);
    video.addEventListener('ended', finish);
    video.addEventListener('seeked', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      video.removeEventListener('canplay', sync);
      video.removeEventListener('error', fail);
      video.removeEventListener('ended', finish);
      video.removeEventListener('seeked', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [
    ref,
    activeSlot,
    ready,
    source,
    paused,
    playbackRate,
    ended,
    nativeLoop,
    bufferedLoop,
    seamlessLoop,
    loop,
    loopFrom,
    requiresInteraction,
  ]);

  function start() {
    const video = buffer.pendingRef.current ?? ref.current ?? firstRef.current;
    if (!video) return;

    setRequested(true);
    prepareLemurVideo(video, source);
    setBlockedSource(null);
    // Safari должен получить play в самом нажатии, до обновления состояния и эффектов.
    play(video);
  }

  function replay() {
    const video = ref.current;
    if (!video) return;

    video.currentTime = startAt ?? LEMUR_PLAYBACK.start;
    setEnded(false);
    start();
  }

  return { ...buffer, error, ended, requiresInteraction, start, replay };
}
