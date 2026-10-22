'use client';

import { useEffect, useEffectEvent, useState } from 'react';

import { EMBEDDED_BO } from '@/config/embedded-bo';
import type { LemurAnimation } from '@/config/lemur-media';
import { useLemurPreview } from '@/hooks/use-lemur-preview';

export function useEmbeddedBo(animation: LemurAnimation, renderTarget?: HTMLElement | null) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const target = renderTarget === undefined ? element : renderTarget;
  const player = useLemurPreview(animation, !target || !visible);
  const start = useEffectEvent(player.start);

  useEffect(() => {
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: EMBEDDED_BO.visibilityThreshold,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    if (!visible || !target || player.reducedMotion || !player.requiresInteraction) return;
    const retry = () => start();
    document.addEventListener('pointerup', retry);
    document.addEventListener('keydown', retry);
    return () => {
      document.removeEventListener('pointerup', retry);
      document.removeEventListener('keydown', retry);
    };
  }, [visible, target, player.reducedMotion, player.requiresInteraction]);

  function react() {
    if (player.reducedMotion) return;
    player.start();
    player.react();
  }

  return {
    ...player,
    setElement,
    react,
    // Экземпляр готов к play в жесте, но скрытый paywall не скачивает видео заранее.
    preload: visible && !player.reducedMotion ? ('auto' as const) : ('none' as const),
  };
}
