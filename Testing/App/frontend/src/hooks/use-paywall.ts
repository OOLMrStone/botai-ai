'use client';

import { createContext, useContext, useRef, useState } from 'react';
import type { EmbeddedBoHandle } from '@/components/lemur/EmbeddedBo';
import type { PaywallEntry } from '@/config/paywall';

interface PaywallContextValue {
  visible: boolean;
  open: (entry: PaywallEntry) => void;
}
export const PaywallContext = createContext<PaywallContextValue | null>(null);

export function usePaywallStage() {
  const playerRef = useRef<EmbeddedBoHandle>(null);
  const [entry, setEntry] = useState<PaywallEntry | null>(null);
  const [target, attach] = useState<HTMLDivElement | null>(null);

  function open(next: PaywallEntry) {
    // Safari должен получить play в исходном жесте, до открытия диалога.
    playerRef.current?.start();
    setEntry(next);
  }

  return {
    playerRef,
    target,
    attach,
    entry,
    close: () => setEntry(null),
    context: { open, visible: Boolean(entry) },
  };
}

export function usePaywall() {
  const context = useContext(PaywallContext);
  if (!context) throw new Error('PaywallProvider is missing');
  return context;
}
