'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { useGridMathValidity } from '@/hooks/use-grid-math-validity';
import { EXPERT_RICH_TEXT, type GridRichTextSegment } from '@/config/expert-rich-text';
import {
  editGridRichTextSegment,
  encloseGridRichTextTail,
  serializeGridRichText,
  tokenizeGridRichText,
} from '@/lib/grid-rich-text';

interface EditableRichTextSegment extends GridRichTextSegment {
  id: string;
}

function readRichText(value: string) {
  return {
    source: value,
    segments: tokenizeGridRichText(value).map((segment, index) => ({
      ...segment,
      id: String(index),
    })),
  };
}

export function useGridRichTextEditor(
  value: string,
  onChange: (value: string) => void,
  onValidityChange?: (valid: boolean) => void,
) {
  const [snapshot, setSnapshot] = useState(() => readRichText(value));
  if (snapshot.source !== value) setSnapshot(readRichText(value));
  const math = useGridMathValidity(
    snapshot.segments.filter((segment) => segment.kind === 'math').map((segment) => segment.id),
  );
  const notifyValidity = useEffectEvent((valid: boolean) => onValidityChange?.(valid));

  useEffect(() => {
    notifyValidity(math.valid);
  }, [math.valid]);

  const publish = (segments: EditableRichTextSegment[]) => {
    const source = serializeGridRichText(segments);
    setSnapshot({ source, segments });
    onChange(source);
  };
  const update = (id: string, next: string) =>
    publish(
      snapshot.segments.map((segment) =>
        segment.id === id ? editGridRichTextSegment(segment, next) : segment,
      ),
    );
  const remove = (id: string) => publish(snapshot.segments.filter((segment) => segment.id !== id));
  const add = (kind: GridRichTextSegment['kind']) =>
    publish([
      ...encloseGridRichTextTail(snapshot.segments),
      {
        ...(kind === 'math' ? EXPERT_RICH_TEXT.newMath : EXPERT_RICH_TEXT.newText),
        id: crypto.randomUUID(),
      },
    ]);

  const segments = snapshot.segments.filter(
    (segment) => segment.kind === 'math' || segment.value === '' || segment.value.trim() !== '',
  );

  return { segments, update, remove, add, setMathValidity: math.setValidity };
}
