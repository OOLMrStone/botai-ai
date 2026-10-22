'use client';

import { useEffect, useState } from 'react';

import { STOREFRONT_GRAPH_VIDEO } from '@/config/storefront-graph';
import { LEMUR_PLAYBACK } from '@/config/lemur-copy';
import { useLemurVideo } from '@/hooks/use-lemur-video';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export function useStorefrontGraph() {
  const [built, setBuilt] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();
  const player = useLemurVideo({
    source: STOREFRONT_GRAPH_VIDEO.video,
    paused: !built || reducedMotion || !visible,
    deferLoad: reducedMotion || !visible,
    playbackRate: LEMUR_PLAYBACK.normal,
    loop: false,
  });

  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  function build() {
    setBuilt(true);
    if (!reducedMotion) player.replay();
  }

  return { built, build, player, reducedMotion, setElement };
}
