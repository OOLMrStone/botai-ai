import type { ExpertNumberLine } from '@/config/expert';
import { EXPERT_GEOMETRY_COPY as COPY } from '@/config/expert-geometry';

function intervalFeedback(from: number | null, to: number | null) {
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)))
    return COPY.invalidCoordinate;

  return from !== null && to !== null && from >= to ? COPY.invalidInterval : null;
}

export function expertNumberLineFeedback(axis: ExpertNumberLine) {
  const values = new Map<number, number>();
  for (const point of axis.points) values.set(point.value, (values.get(point.value) ?? 0) + 1);
  const points = new Map(
    axis.points.map((point) => {
      const message = !Number.isFinite(point.value)
        ? COPY.invalidCoordinate
        : (values.get(point.value) ?? 0) > 1
          ? COPY.duplicateCoordinate
          : point.value < axis.min || point.value > axis.max
            ? COPY.coordinateOutsideAxis
            : null;

      return [point.id, message];
    }),
  );
  const intervals = new Map(
    axis.intervals.map((interval) => [interval.id, intervalFeedback(interval.from, interval.to)]),
  );

  return {
    points,
    intervals,
    axis:
      !Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min >= axis.max
        ? COPY.invalidAxis
        : null,
    domain: axis.domain ? intervalFeedback(axis.domain.from, axis.domain.to) : null,
  };
}
