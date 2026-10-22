'use client';

import { useState } from 'react';

import { LEMUR_COPY, LEMUR_PLAYBACK } from '@/config/lemur-copy';
import type { LemurAnimation } from '@/config/lemur-media';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useLemurReactionQueue } from '@/hooks/use-lemur-reaction-queue';
import { useLemurVideo } from '@/hooks/use-lemur-video';

export function useLemurPreview(animation: LemurAnimation, suspended = false) {
  const reducedMotion = useReducedMotion();
  const [pauseOverride, setPauseOverride] = useState<boolean | null>(null);
  const [slowed, setSlowed] = useState(false);
  const [reactionPhase, setReactionPhase] = useState<'idle' | 'queued' | 'playing'>('idle');
  const [reactionError, setReactionError] = useState('');
  const [reactionPaused, setReactionPaused] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [idleStartAt, setIdleStartAt] = useState<number>(LEMUR_PLAYBACK.start);

  const reaction = animation.reaction;
  const clip = reaction?.phases?.[phaseIndex];
  const reactionSource = clip?.video ?? reaction?.video;
  const reacting = reactionPhase === 'playing';
  const queued = reactionPhase === 'queued';
  const reactionBusy = reactionPhase !== 'idle';
  const paused = suspended || (reactionBusy ? reactionPaused : (pauseOverride ?? reducedMotion));
  const playbackRate = slowed ? LEMUR_PLAYBACK.slow : LEMUR_PLAYBACK.normal;
  const source = reacting && reactionSource ? reactionSource : animation.video;
  const returnAt = reaction?.cycleDuration
    ? ((clip?.offset ?? 0) + (reaction.duration ?? 0)) % reaction.cycleDuration
    : LEMUR_PLAYBACK.start;
  const prepared =
    queued && reactionSource
      ? { source: reactionSource }
      : reacting
        ? { source: animation.video, startAt: returnAt }
        : undefined;
  const video = useLemurVideo({
    deferLoad: suspended || reducedMotion,
    source,
    startAt: reacting ? LEMUR_PLAYBACK.start : idleStartAt,
    prepared,
    paused,
    playbackRate,
    loop: !reacting && animation.loop,
    seamlessLoop: animation.seamlessLoop,
    loopFrom: reacting ? undefined : animation.loopFrom,
    onFinish: reacting
      ? () => {
          setIdleStartAt(returnAt);
          setReactionPhase('idle');
        }
      : undefined,
    onError: (message) => {
      if (!reactionBusy) return;
      setReactionError(message);
      setReactionPhase('idle');
    },
  });
  useLemurReactionQueue(video.ref, queued, video.ready, reaction, (time) => {
    if (reaction?.phases && reaction.syncPeriod) {
      setPhaseIndex(Math.round(time / reaction.syncPeriod) % reaction.phases.length);
    }
    setReactionPhase('playing');
  });

  function react() {
    if (!reaction || reactionBusy || !video.ready) return;

    if (reaction.phases && reaction.syncPeriod) {
      const time = video.ref.current?.currentTime ?? LEMUR_PLAYBACK.start;
      const index = Math.ceil((time - (reaction.syncTolerance ?? 0)) / reaction.syncPeriod);
      setPhaseIndex(Math.max(0, index) % reaction.phases.length);
    }
    setReactionPaused(false);
    setReactionError('');
    setReactionPhase(reaction.syncPeriod ? 'queued' : 'playing');
  }

  function togglePause() {
    if (video.ended) {
      video.replay();
      setPauseOverride(false);
      return;
    }

    if (!video.ready || video.requiresInteraction || paused) {
      video.start();
      if (reactionBusy) setReactionPaused(false);
      else setPauseOverride(false);
      return;
    }

    if (reactionBusy) {
      setReactionPaused(!paused);
      return;
    }

    setPauseOverride(!paused);
  }

  function start() {
    if (reducedMotion) return;
    video.start();
    setPauseOverride(false);
  }

  return {
    start,
    reducedMotion,
    requiresInteraction: video.requiresInteraction,
    firstRef: video.firstRef,
    secondRef: video.secondRef,
    activeSlot: video.activeSlot,
    error: reactionError || video.error,
    subtitle: queued ? (reaction?.pendingLabel ?? animation.subtitle) : animation.subtitle,
    reactionBusy: reactionBusy || !video.ready,
    react,
    pauseLabel:
      !video.ready || video.requiresInteraction
        ? LEMUR_COPY.start
        : video.ended
          ? LEMUR_COPY.replay
          : paused
            ? LEMUR_COPY.resume
            : LEMUR_COPY.pause,
    speedLabel: slowed ? LEMUR_COPY.normal : LEMUR_COPY.slow,
    togglePause,
    toggleSpeed: () => setSlowed((value) => !value),
  };
}
