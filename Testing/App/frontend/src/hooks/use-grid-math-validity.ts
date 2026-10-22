'use client';

import { useState } from 'react';

export function useGridMathValidity(ids: string[]) {
  const [readiness, setReadiness] = useState<Record<string, boolean>>({});
  const valid = ids.every((id) => readiness[id] === true);
  const setValidity = (id: string, ready: boolean) =>
    setReadiness((current) => (current[id] === ready ? current : { ...current, [id]: ready }));

  return { valid, setValidity };
}
