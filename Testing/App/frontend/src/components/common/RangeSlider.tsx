'use client';

import { useRef, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { cn } from '@/lib/utils';
import { preventGestureContextMenu } from '@/lib/gesture-surface';

import { layout } from '@/config/layout';

interface RangeSliderProps {
  value: number;
  valueLabel: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: readonly string[];
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function RangeSlider({
  value,
  valueLabel,
  label,
  min,
  max,
  step,
  scale,
  onChange,
  disabled,
}: RangeSliderProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  useGestureSurfaceGuard(surfaceRef);
  const progress = (value - min) / (max - min);
  const progressStyle = {
    '--difficulty-progress': progress,
    '--difficulty-position': `${progress * 100}%`,
  } as CSSProperties;

  return (
    <div className={layout.tasks.difficultyControl}>
      <div className={layout.tasks.difficultyValue} aria-hidden="true">
        {valueLabel}
      </div>
      <div
        ref={surfaceRef}
        onContextMenu={preventGestureContextMenu}
        className={cn(layout.tasks.difficultySliderWrap, layout.gestureSurface)}
        style={progressStyle}
      >
        <div className={layout.tasks.difficultyTrack} aria-hidden="true">
          <span className={layout.tasks.difficultyTrackFill} />
        </div>
        <span aria-hidden="true" className={layout.tasks.difficultyThumb} />
        <input
          type="range"
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuetext={valueLabel}
          className={layout.tasks.difficultySlider}
          onInput={(event) => onChange(Number(event.currentTarget.value))}
        />
      </div>
      <div className={layout.tasks.difficultyScaleActions}>
        {scale.map((item, index) => {
          const position = min + ((max - min) * index) / (scale.length - 1);
          return (
            <Button
              key={item}
              variant="ghost"
              size="compact"
              disabled={disabled}
              aria-pressed={value === position}
              className={cn(
                layout.tasks.difficultyScaleAction,
                value === position && layout.tasks.difficultyScaleActive,
              )}
              onClick={() => onChange(position)}
            >
              {item}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
