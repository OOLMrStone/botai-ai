import type { PointerEventHandler } from 'react';

import { MathFormula } from '@/components/common/MathFormula';
import { Button } from '@/components/ui/button';
import type { ExpertMathSymbol } from '@/config/expert-math';
import { layout } from '@/config/layout';

export interface ExpertMathSymbolActions {
  onInsert: (template: string) => void;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

export function ExpertMathSymbolButton({
  symbol,
  onInsert,
  onPointerDown,
  disabled,
}: ExpertMathSymbolActions & { symbol: ExpertMathSymbol }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={symbol.wide ? 'compact' : 'icon-compact'}
      className={layout.expertMath.symbol}
      aria-label={symbol.label}
      title={symbol.label}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={() => onInsert(symbol.insert)}
    >
      <span aria-hidden="true">
        <MathFormula value={symbol.preview} />
      </span>
    </Button>
  );
}
