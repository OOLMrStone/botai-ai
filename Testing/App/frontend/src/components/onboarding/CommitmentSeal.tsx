'use client';

import { Check } from 'lucide-react';
import { useEffect } from 'react';

import type { CSSProperties } from 'react';

import { COMMITMENT_SEAL } from '@/config/constants';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';
import { useCommitmentSeal } from '@/hooks/use-commitment-seal';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface CommitmentSealProps {
  date: string;
  onSealChange?: (sealed: boolean) => void;
}

type SealStyle = CSSProperties & {
  '--commitment-seal-duration': string;
  '--commitment-seal-scale': number;
};

export function CommitmentSeal({ date, onSealChange }: CommitmentSealProps) {
  const { isHolding, isSealed, startHold, activateFromKeyboard, trackHold, endHold, cancelHold } =
    useCommitmentSeal();

  const style: SealStyle = {
    '--commitment-seal-duration': `${COMMITMENT_SEAL.holdDurationMs}ms`,
    '--commitment-seal-scale': isHolding || isSealed ? 1 : 0,
  };

  useEffect(() => {
    onSealChange?.(isSealed);
  }, [isSealed, onSealChange]);

  return (
    <div
      className={cn(layout.commitment.block, layout.gestureSurface)}
      onContextMenu={preventGestureContextMenu}
    >
      <button
        type="button"
        aria-label={isSealed ? COPY.commitment.sealedPrefix : COPY.commitment.sealHint}
        aria-pressed={isSealed}
        onPointerDown={startHold}
        onPointerMove={trackHold}
        onPointerUp={endHold}
        onPointerCancel={cancelHold}
        onLostPointerCapture={cancelHold}
        onKeyDown={activateFromKeyboard}
        onBlur={cancelHold}
        className={layout.commitment.seal}
        style={style}
      >
        <span className={layout.commitment.fill} />
        {isSealed ? (
          <Check aria-hidden className={layout.commitment.check} strokeWidth={2.5} />
        ) : (
          <span
            className={cn(
              layout.commitment.label,
              isHolding ? layout.commitment.labelHolding : layout.commitment.labelIdle,
            )}
          >
            {isHolding ? COPY.commitment.sealHolding : COPY.commitment.sealIdle}
          </span>
        )}
      </button>
      <p
        className={cn(
          layout.commitment.status,
          isSealed ? layout.commitment.statusVisible : undefined,
        )}
        suppressHydrationWarning
        aria-live="polite"
      >
        {isSealed ? `${COPY.commitment.sealedPrefix} ${date}` : COPY.commitment.sealHint}
      </p>
    </div>
  );
}
