import type { ExpertNumberLine, ExpertUnitCircle } from '@/config/expert';
import { expertSolutionLayout, EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';

export function buildExpertNumberLine(axis: ExpertNumberLine) {
  const geometry = expertSolutionLayout.numberLine;
  const { x1, x2, y1: y } = geometry.axis;
  const project = (value: number) =>
    x1 +
    ((Math.max(axis.min, Math.min(axis.max, value)) - axis.min) / (axis.max - axis.min)) *
      (x2 - x1);

  if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.max <= axis.min) {
    return null;
  }

  const intervals = axis.intervals
    .filter((interval) => (interval.to ?? axis.max) > (interval.from ?? axis.min))
    .map((interval) => {
      const start = project(interval.from ?? axis.min);
      const end = project(interval.to ?? axis.max);
      const direction = interval.sign === '-' ? 1 : -1;
      const handle = (end - start) * geometry.curveHandleRatio;
      const curveY = y + direction * geometry.curveAmplitude;
      const tailY = y + direction * geometry.rayHeight;
      const rayHandle = (end - start) * geometry.rayHandleRatio;
      let curve = `M ${start} ${y} C ${start + handle} ${curveY}, ${end - handle} ${curveY}, ${end} ${y}`;

      if (interval.from === null && interval.to === null) {
        curve = `M ${start} ${tailY} L ${end} ${tailY}`;
      } else if (interval.from === null) {
        curve = `M ${start} ${tailY} C ${start + rayHandle} ${tailY}, ${end} ${tailY}, ${end} ${y}`;
      } else if (interval.to === null) {
        curve = `M ${start} ${y} C ${start} ${tailY}, ${end - rayHandle} ${tailY}, ${end} ${tailY}`;
      }

      return {
        ...interval,
        start,
        end,
        curve,
        signX: (start + end) / 2,
        signY: interval.sign === '-' ? geometry.negativeSignY : geometry.positiveSignY,
      };
    });
  const points = axis.points
    .filter(
      (point) => Number.isFinite(point.value) && point.value >= axis.min && point.value <= axis.max,
    )
    .map((point) => {
      const included = point.marker === undefined ? point.included : point.marker === 'closed';

      return {
        ...point,
        included,
        hasMarker: point.marker !== null,
        x: project(point.value),
        selected: included && axis.selectedPoints.includes(point.id),
      };
    });
  const boundaries = axis.domain
    ? [axis.domain.from, axis.domain.to]
        .filter(
          (value): value is number => value !== null && value >= axis.min && value <= axis.max,
        )
        .map((value) => ({
          value,
          x: project(value),
          showLabel: !points.some((point) => point.value === value),
        }))
    : [];

  return {
    intervals,
    points,
    boundaries,
    domainLabel: axis.domain
      ? EXPERT_SOLUTION_COPY.domain(axis.label, axis.domain.from, axis.domain.to)
      : '',
    domainLabelX: boundaries[0]?.x ?? x1,
  };
}

function circlePosition(angle: number, radius: number) {
  const { center } = expertSolutionLayout.circleGeometry;

  return { x: center.x + Math.cos(angle) * radius, y: center.y - Math.sin(angle) * radius };
}

function circleArcPath(arc: ExpertUnitCircle['arcs'][number]) {
  const { radius, fullTurn, halfTurn } = expertSolutionLayout.circleGeometry;
  const start = circlePosition(arc.from, radius);
  const end = circlePosition(arc.to, radius);
  const rawSpan = arc.direction === 'ccw' ? arc.to - arc.from : arc.from - arc.to;
  const span = ((rawSpan % fullTurn) + fullTurn) % fullTurn;
  const sweep = arc.direction === 'ccw' ? 0 : 1;

  if (arc.fullCircle ?? span === 0) {
    const opposite = circlePosition(arc.from + halfTurn, radius);

    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 0 ${sweep} ${start.x} ${start.y}`;
  }

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${span > halfTurn ? 1 : 0} ${sweep} ${end.x} ${end.y}`;
}

export function buildExpertUnitCircle(circle: ExpertUnitCircle) {
  const { radius, labelRadius, labelBox } = expertSolutionLayout.circleGeometry;
  const points = circle.points
    .filter((point) => Number.isFinite(point.angle))
    .map((point) => {
      const position = circlePosition(point.angle, radius);
      const label = circlePosition(point.angle, labelRadius);

      return {
        ...point,
        ...position,
        hasMarker: point.marker !== null,
        selected: point.marker !== null && point.selected,
        filled: point.marker !== 'open',
        labelX: label.x - labelBox.width / 2,
        labelY: label.y - labelBox.height / 2,
      };
    });
  const arcs = circle.arcs
    .filter((arc) => Number.isFinite(arc.from) && Number.isFinite(arc.to))
    .map((arc) => ({ ...arc, path: circleArcPath(arc) }));

  return { points, arcs };
}
