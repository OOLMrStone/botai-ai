import { TASK_DRAWING } from '@/config/constants';
import type { DrawingPoint, DrawingStroke } from '@/config/tasks';
import { createClientId } from '@/lib/client-id';

export type EraserTool = 'stroke-eraser' | 'point-eraser';

export function drawingPointDistance(a: DrawingPoint, b: DrawingPoint, width: number) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * width);
}

// Обе оси используют ширину листа, поэтому поворот не деформирует записи.
export function migrateDrawingToWorkspace(
  strokes: DrawingStroke[],
  legacyHeight: number,
  width: number,
) {
  if (width <= 0) return strokes;
  return strokes.map((stroke) =>
    stroke.coordinateSpace === 'width'
      ? stroke
      : {
          ...stroke,
          coordinateSpace: 'width' as const,
          points: stroke.points.map((point) => ({
            ...point,
            y: (stroke.coordinateSpace === 'workspace' ? point.y : point.y * legacyHeight) / width,
          })),
        },
  );
}

export function drawingBottom(strokes: DrawingStroke[], width: number) {
  return strokes.reduce((bottom, stroke) => {
    if (!stroke.coordinateSpace) return bottom;
    return stroke.points.reduce(
      (strokeBottom, point) =>
        Math.max(strokeBottom, stroke.coordinateSpace === 'width' ? point.y * width : point.y),
      bottom,
    );
  }, 0);
}

function densify(points: DrawingPoint[], width: number) {
  return points.flatMap((point, index) => {
    const next = points[index + 1];
    if (!next) return [point];
    const steps = Math.max(
      1,
      Math.ceil(drawingPointDistance(point, next, width) / (TASK_DRAWING.eraserRadius / 2)),
    );
    return Array.from({ length: steps }, (_, step) => ({
      x: point.x + ((next.x - point.x) * step) / steps,
      y: point.y + ((next.y - point.y) * step) / steps,
    }));
  });
}

export function eraseDrawingAt(
  strokes: DrawingStroke[],
  point: DrawingPoint,
  width: number,
  tool: EraserTool,
) {
  if (tool === 'stroke-eraser') {
    return strokes.filter((stroke) =>
      densify(stroke.points, width).every(
        (strokePoint) =>
          drawingPointDistance(strokePoint, point, width) > TASK_DRAWING.eraserRadius,
      ),
    );
  }

  return strokes.flatMap((stroke) => {
    if (stroke.points.length === 1) {
      return drawingPointDistance(stroke.points[0], point, width) <= TASK_DRAWING.eraserRadius
        ? []
        : [stroke];
    }

    const segments: DrawingStroke[] = [];
    let points: DrawingPoint[] = [];
    for (const strokePoint of densify(stroke.points, width)) {
      if (drawingPointDistance(strokePoint, point, width) <= TASK_DRAWING.eraserRadius) {
        if (points.length > 1)
          segments.push({ id: createClientId(), points, coordinateSpace: 'width' });
        points = [];
      } else points.push(strokePoint);
    }
    if (points.length > 1)
      segments.push({ id: createClientId(), points, coordinateSpace: 'width' });
    return segments;
  });
}
