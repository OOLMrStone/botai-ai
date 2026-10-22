'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { createLemurAlphaRenderer } from '@/lib/lemur-alpha-renderer';

export function useLemurAlphaFrame(videoRef: RefObject<HTMLVideoElement | null>, enabled = true) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [presented, setPresented] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !video || !canvas) return;
    let renderer: ReturnType<typeof createLemurAlphaRenderer> = null;

    let frame: number | null = null;
    let lastTime = -1;
    let shown = false;
    const nativeCallback = typeof video.requestVideoFrameCallback === 'function';
    const stop = () => {
      if (frame === null) return;
      if (nativeCallback) video.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      frame = null;
    };
    const draw = () => {
      if (document.hidden || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (video.currentTime === lastTime) return;
      // Ещё не загруженный слот не занимает GPU при первом открытии.
      renderer ??= createLemurAlphaRenderer(canvas);
      if (!renderer) return;
      renderer.draw(video);
      lastTime = video.currentTime;
      if (!shown) {
        shown = true;
        setPresented(true);
      }
    };
    const tick = () => {
      frame = null;
      draw();
      if (!video.ended && !document.hidden && (nativeCallback || !video.paused)) schedule();
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = nativeCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    const sync = () => {
      if (document.hidden) {
        stop();
        return;
      }
      draw();
      if (!video.ended && (nativeCallback || !video.paused)) schedule();
    };
    const reset = () => {
      lastTime = -1;
      shown = false;
      setPresented(false);
      stop();
    };
    video.addEventListener('play', sync);
    video.addEventListener('playing', sync);
    video.addEventListener('loadeddata', sync);
    video.addEventListener('seeked', sync);
    video.addEventListener('pause', stop);
    video.addEventListener('loadstart', reset);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      stop();
      video.removeEventListener('play', sync);
      video.removeEventListener('playing', sync);
      video.removeEventListener('loadeddata', sync);
      video.removeEventListener('seeked', sync);
      video.removeEventListener('pause', stop);
      video.removeEventListener('loadstart', reset);
      document.removeEventListener('visibilitychange', sync);
      renderer?.destroy();
    };
  }, [videoRef, enabled]);

  return { canvasRef, presented };
}
