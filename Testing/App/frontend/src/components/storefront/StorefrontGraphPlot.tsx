import Image from 'next/image';

import { LemurVideo } from '@/components/lemur/LemurVideo';
import { layout } from '@/config/layout';
import { STOREFRONT_COPY as COPY, STOREFRONT_GRAPH_ANIMATION } from '@/config/storefront';
import { STOREFRONT_GRAPH_VIDEO as GRAPH } from '@/config/storefront-graph';
import type { useStorefrontGraph } from '@/hooks/use-storefront-graph';

export function StorefrontGraphPlot({
  built,
  reducedMotion,
  player,
}: Pick<ReturnType<typeof useStorefrontGraph>, 'built' | 'reducedMotion' | 'player'>) {
  return (
    <div className={layout.storefront.graphPlot}>
      {reducedMotion ? (
        <Image
          src={built ? GRAPH.complete : GRAPH.poster}
          alt={COPY.graph.label}
          width={GRAPH.width}
          height={GRAPH.height}
          className={layout.storefront.graphSvg}
        />
      ) : (
        <LemurVideo
          animation={STOREFRONT_GRAPH_ANIMATION}
          firstRef={player.firstRef}
          secondRef={player.secondRef}
          activeSlot={player.activeSlot}
          reactionBusy
          onReact={player.start}
          error={player.error}
        />
      )}
    </div>
  );
}
