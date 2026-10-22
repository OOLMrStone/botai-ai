'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { LEMUR_COPY, LEMUR_PLAYBACK } from '@/config/lemur-copy';
import { prepareLemurVideo } from '@/lib/lemur-video-source';

export interface LemurVideoRequest {
  source: string;
  startAt?: number;
}

interface LemurVideoBufferOptions extends LemurVideoRequest {
  prepared?: LemurVideoRequest;
  onReady: () => void;
  onError: (message: string) => void;
  enabled?: boolean;
}

export function useLemurVideoBuffer({
  source,
  startAt = LEMUR_PLAYBACK.start,
  prepared,
  onReady,
  onError,
  enabled = true,
}: LemurVideoBufferOptions) {
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const pendingRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState<{
    slot: number;
    source: string;
    startAt: number;
  } | null>(null);
  const activeRequest = useRef<{ source: string; startAt: number } | null>(null);
  const decoded = useRef<{
    video: HTMLVideoElement;
    slot: number;
    source: string;
    startAt: number;
  } | null>(null);
  const ready = active?.source === source && active.startAt === startAt;
  const announceReady = useEffectEvent(onReady);
  const announceError = useEffectEvent(onError);
  const preparedSource = prepared?.source;
  const preparedStart = prepared?.startAt ?? LEMUR_PLAYBACK.start;

  useEffect(() => {
    if (!enabled) return;
    const current = activeRequest.current;
    const activate = current?.source !== source || current.startAt !== startAt;
    const candidate = activate
      ? { source, startAt }
      : preparedSource
        ? { source: preparedSource, startAt: preparedStart }
        : null;
    if (!candidate) return;

    const slot = ref.current === firstRef.current ? 1 : 0;
    const target = slot === 0 ? firstRef.current : secondRef.current;
    if (!target) return;

    if (activate) {
      ref.current?.pause();
      pendingRef.current = target;
    }
    let positioned = false;
    let activated = false;

    const prepare = () => {
      if (target.readyState < HTMLMediaElement.HAVE_METADATA) return;
      if (!positioned) {
        positioned = true;
        if (target.currentTime !== candidate.startAt) target.currentTime = candidate.startAt;
      }
      if (target.seeking || target.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!activate) {
        decoded.current = { video: target, slot, ...candidate };
        return;
      }
      if (activated) return;

      activated = true;
      ref.current = target;
      activeRequest.current = candidate;
      setActive({ slot, ...candidate });
      announceReady();
    };
    const fail = () => announceError(LEMUR_COPY.loadError);

    target.addEventListener('loadedmetadata', prepare);
    target.addEventListener('loadeddata', prepare);
    target.addEventListener('canplay', prepare);
    target.addEventListener('seeked', prepare);
    target.addEventListener('error', fail);
    if (target.getAttribute('src') !== candidate.source || target.error) {
      prepareLemurVideo(target, candidate.source);
    } else {
      prepare();
    }

    return () => {
      if (decoded.current?.video === target) decoded.current = null;
      if (pendingRef.current === target) pendingRef.current = null;
      target.removeEventListener('loadedmetadata', prepare);
      target.removeEventListener('loadeddata', prepare);
      target.removeEventListener('canplay', prepare);
      target.removeEventListener('seeked', prepare);
      target.removeEventListener('error', fail);
    };
  }, [
    enabled,
    source,
    startAt,
    preparedSource,
    preparedStart,
    active?.slot,
    active?.source,
    active?.startAt,
  ]);

  function preparedLoopVideo() {
    const next = decoded.current;
    if (
      !next ||
      next.source !== source ||
      next.startAt !== LEMUR_PLAYBACK.start ||
      next.video.seeking ||
      next.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      return null;

    return next.video;
  }

  function advanceLoop() {
    const next = decoded.current;
    if (!next || !preparedLoopVideo()) return null;

    decoded.current = null;
    const previous = ref.current;
    ref.current = next.video;
    previous?.pause();
    activeRequest.current = { source, startAt };
    setActive({ slot: next.slot, source, startAt });
    onReady();

    return next.video;
  }

  return {
    ref,
    pendingRef,
    firstRef,
    secondRef,
    activeSlot: active?.slot ?? 0,
    ready,
    advanceLoop,
    preparedLoopVideo,
  };
}
