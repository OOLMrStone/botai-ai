'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { PaywallScreen } from '@/components/paywall/PaywallScreen';
import { layout } from '@/config/layout';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';
import { PAYWALL_COPY } from '@/config/paywall';
import { PaywallContext, usePaywallStage } from '@/hooks/use-paywall';

export function PaywallProvider({ children }: { children: ReactNode }) {
  const { playerRef, target, entry, attach, close, context } = usePaywallStage();
  return (
    <PaywallContext value={context}>
      <EmbeddedBo ref={playerRef} animation={LEMUR_ANIMATIONS.paywall} renderTarget={target} />
      {children}
      <Dialog.Root
        open={Boolean(entry)}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Popup
            className={layout.paywall.popup}
            aria-label={entry ? PAYWALL_COPY[entry].title : undefined}
          >
            {entry ? <PaywallScreen entry={entry} onClose={close} attach={attach} /> : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </PaywallContext>
  );
}
