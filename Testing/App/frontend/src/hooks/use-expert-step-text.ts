'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import type { ExpertDiagram } from '@/config/expert';
import { useGridMathValidity } from '@/hooks/use-grid-math-validity';
import { expertStepTextParts, replaceExpertStepTextPart } from '@/lib/expert-step-text';

export function useExpertStepText(
  value: string,
  diagram: ExpertDiagram | undefined,
  onChange: (value: string) => void,
  onValidityChange?: (valid: boolean) => void,
) {
  const [snapshot, setSnapshot] = useState(() => ({
    source: value,
    parts: expertStepTextParts(value, diagram),
  }));
  if (snapshot.source !== value)
    setSnapshot({ source: value, parts: expertStepTextParts(value, diagram) });
  const visibleParts = snapshot.parts.filter((part) => part.value.trim() || part.value === '');
  const parts = visibleParts.length ? visibleParts : snapshot.parts;
  const validity = useGridMathValidity(parts.map((part) => part.id));
  const notifyValidity = useEffectEvent((valid: boolean) => onValidityChange?.(valid));

  useEffect(() => {
    notifyValidity(validity.valid);
  }, [validity.valid]);

  return {
    parts,
    setValidity: validity.setValidity,
    update: (id: string, next: string) => {
      const parts = replaceExpertStepTextPart(snapshot.parts, id, next);
      const source = parts.map((part) => part.value).join('');
      setSnapshot({ source, parts });
      onChange(source);
    },
  };
}
