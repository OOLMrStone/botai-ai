import type { RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import {
  ExpertMathSymbolButton,
  type ExpertMathSymbolActions,
} from '@/components/expert/ExpertMathSymbolButton';
import { Button } from '@/components/ui/button';
import { EXPERT_MATH, EXPERT_MATH_COPY as COPY } from '@/config/expert-math';
import { layout } from '@/config/layout';
import { useHorizontalScrollEdges } from '@/hooks/use-horizontal-scroll-edges';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface ExpertMathToolbarProps extends ExpertMathSymbolActions {
  toolbarRef: RefObject<HTMLDivElement | null>;
  paletteId: string;
  symbolsOpen: boolean;
  onToggleSymbols: () => void;
}

export function ExpertMathToolbar({
  toolbarRef,
  paletteId,
  symbolsOpen,
  onToggleSymbols,
  onInsert,
  onPointerDown,
  disabled,
}: ExpertMathToolbarProps) {
  const styles = layout.expertMath;
  const Chevron = symbolsOpen ? ChevronUp : ChevronDown;
  const { viewportRef, contentRef, showStartFade, showEndFade } = useHorizontalScrollEdges(
    EXPERT_MATH.scrollEdgeTolerance,
  );

  return (
    <div
      ref={toolbarRef}
      className={cn(styles.tools, layout.gestureSurface)}
      onContextMenu={preventGestureContextMenu}
    >
      <div
        ref={viewportRef}
        className={cn(
          styles.presets,
          showStartFade && showEndFade
            ? styles.presetsFadeBoth
            : showStartFade
              ? styles.presetsFadeStart
              : showEndFade && styles.presetsFadeEnd,
        )}
        role="group"
        aria-label={COPY.popularLabel}
      >
        <div ref={contentRef} className={styles.presetItems}>
          {EXPERT_MATH.presets.map((symbol) => (
            <ExpertMathSymbolButton
              key={symbol.id}
              symbol={symbol}
              onInsert={onInsert}
              onPointerDown={onPointerDown}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className={styles.symbolsToggle}
        disabled={disabled}
        aria-label={COPY.allSymbols}
        aria-controls={paletteId}
        aria-expanded={symbolsOpen}
        onPointerDown={onPointerDown}
        onClick={onToggleSymbols}
      >
        {COPY.symbols}
        <Chevron className={styles.icon} aria-hidden="true" />
      </Button>
    </div>
  );
}
