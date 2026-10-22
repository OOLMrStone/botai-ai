'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import type { ExpertNativeDiagram } from '@/config/expert';
import { EXPERT_NATIVE_EDITOR as CONFIG } from '@/config/expert-native-editor';
import { useGridMathValidity } from '@/hooks/use-grid-math-validity';
import { validateExpertDiagram } from '@/lib/expert';
import { addNativePoint, updateNativePoint } from '@/lib/expert-native-editor';

export function useExpertNativeGeometry(
  diagram: ExpertNativeDiagram,
  onChange: (diagram: ExpertNativeDiagram) => void,
  onValidityChange?: (valid: boolean) => void,
) {
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const ids = diagram.points.map((point) => CONFIG.fields.point(point.id));
  if (diagram.kind === 'number_line_v2') {
    ids.push(CONFIG.fields.variable);
    if (diagram.note !== null) ids.push(CONFIG.fields.note);
  }
  const math = useGridMathValidity(ids.filter((id) => changed.has(id)));
  const structuralError = validateExpertDiagram(diagram);
  const valid = structuralError === null && math.valid;
  const notifyValidity = useEffectEvent((ready: boolean) => onValidityChange?.(ready));

  useEffect(() => {
    notifyValidity(valid);
  }, [valid]);

  const touch = (key: string) =>
    setChanged((current) => (current.has(key) ? current : new Set([...current, key])));
  const setPointValue = (id: string, value: string) => {
    touch(CONFIG.fields.point(id));
    onChange(updateNativePoint(diagram, id, { value }));
  };
  const addPoint = () => {
    const id = crypto.randomUUID();
    touch(CONFIG.fields.point(id));
    onChange(addNativePoint(diagram, id));
  };
  const setVariable = (variable: string) => {
    if (diagram.kind !== 'number_line_v2') return;
    touch(CONFIG.fields.variable);
    onChange({ ...diagram, variable });
  };
  const setNote = (note: string) => {
    if (diagram.kind !== 'number_line_v2') return;
    touch(CONFIG.fields.note);
    onChange({ ...diagram, note: note.trim() ? note : null });
  };

  return {
    structuralError,
    addPoint,
    setPointValue,
    setVariable,
    setNote,
    setMathValidity: math.setValidity,
  };
}

export type ExpertNativeGeometryFields = ReturnType<typeof useExpertNativeGeometry>;
