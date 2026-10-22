'use client';

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  formatGeometryAngle,
  parseGeometryExpression,
  parseGeometryNumber,
} from '@/lib/grid-geometry';
import { useGridMathValidity } from '@/hooks/use-grid-math-validity';

export function useGridGeometry(mathIds: string[], onValidityChange?: (valid: boolean) => void) {
  const [drafts, setDrafts] = useState<Record<string, { text: string; valid: boolean }>>({});
  const math = useGridMathValidity(mathIds);
  const numbersValid = Object.values(drafts).every((draft) => draft.valid);
  const valid = numbersValid && math.valid;

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const bindNumber = (
    key: string,
    value: number | null,
    onChange: (value: number | null) => void,
    optional: boolean,
    angle: boolean,
  ) => ({
    value:
      drafts[key]?.text ??
      (value === null ? '' : angle ? formatGeometryAngle(value) : String(value)),
    invalid: drafts[key]?.valid === false,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value;
      const parsed = parseGeometryNumber(text, optional);
      setDrafts((current) => ({ ...current, [key]: { text, valid: parsed.valid } }));
      if (parsed.valid) onChange(parsed.value);
    },
  });
  const expression = (
    key: string,
    value: string,
    onChange: (angle: number, label: string) => void,
  ) => ({
    value: drafts[key]?.text ?? value,
    invalid: drafts[key]?.valid === false,
    onChange: (text: string) => {
      const parsed = parseGeometryExpression(text);
      setDrafts((current) => ({ ...current, [key]: { text, valid: parsed.valid } }));
      if (parsed.valid && parsed.value !== null) onChange(parsed.value, text);
    },
  });
  const required = (key: string, value: number, onChange: (value: number) => void, angle = false) =>
    bindNumber(
      key,
      value,
      (next) => {
        if (next !== null) onChange(next);
      },
      false,
      angle,
    );
  const optional = (key: string, value: number | null, onChange: (value: number | null) => void) =>
    bindNumber(key, value, onChange, true, false);
  const clear = (prefix: string) =>
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))),
    );
  const createId = () => crypto.randomUUID();

  return {
    required,
    expression,
    optional,
    clear,
    createId,
    valid,
    numbersValid,
    setMathValidity: math.setValidity,
  };
}

export type GridGeometryFields = ReturnType<typeof useGridGeometry>;
