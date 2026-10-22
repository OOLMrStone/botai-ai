'use client';

import Image from 'next/image';

import { StorefrontGraphPlot } from '@/components/storefront/StorefrontGraphPlot';

import { MathFormula } from '@/components/common/MathFormula';
import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { Button } from '@/components/ui/button';
import { LANDING_BO, LANDING_BO_HOLDER } from '@/config/landing-bo';
import { layout } from '@/config/layout';
import { STOREFRONT_COPY as COPY } from '@/config/storefront';
import { useStorefrontGraph } from '@/hooks/use-storefront-graph';
import { cn } from '@/lib/utils';

export function StorefrontGraph() {
  const { built, build, player, reducedMotion, setElement } = useStorefrontGraph();

  return (
    <div ref={setElement} className={layout.storefront.graphStage}>
      <div
        className={layout.storefront.graphHeadroom}
        style={{ aspectRatio: 1 / LANDING_BO_HOLDER.contactLine }}
        aria-hidden="true"
      />
      <div className={layout.storefront.graphCharacter}>
        <EmbeddedBo animation={LANDING_BO.holder} className={layout.storefront.graphBo} />
        <Image {...LANDING_BO_HOLDER.paws} alt="" className={layout.storefront.graphPaws} />
      </div>
      <div className={layout.storefront.graphWindow}>
        <div className={layout.storefront.graphChrome}>
          <div className={layout.storefront.graphDots} aria-hidden="true">
            {COPY.graph.dots.map((dot) => (
              <span
                key={dot}
                className={cn(layout.storefront.graphDot, layout.storefront.graphDotColors[dot])}
              />
            ))}
          </div>
          <Wordmark variant="compact" />
        </div>
        <div className={layout.storefront.graphBody}>
          <div className={layout.storefront.graphControls}>
            <p className={layout.storefront.graphInstruction}>{COPY.graph.instruction}</p>
            <Button variant="storefrontDark" onClick={build}>
              {built ? COPY.graph.reset : COPY.graph.build}
            </Button>
          </div>
          <MathFormula value={COPY.graph.equation} className={layout.storefront.graphEquation} />
          <StorefrontGraphPlot built={built} reducedMotion={reducedMotion} player={player} />
        </div>
      </div>
    </div>
  );
}
