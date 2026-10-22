'use client';

import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { layout } from '@/config/layout';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';

export function HomeHangingBo() {
  return <EmbeddedBo animation={LEMUR_ANIMATIONS.hang} className={layout.embeddedBo.hanging} />;
}
