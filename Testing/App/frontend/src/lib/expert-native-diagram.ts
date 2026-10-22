import type {
  ExpertNativeArc,
  ExpertNativeCircleArc,
  ExpertNativeNumberLine,
  ExpertNativeUnitCircle,
} from '@/config/expert';
import { EXPERT_NATIVE_DIAGRAM as NATIVE } from '@/config/expert-native-diagram';
import { expertSolutionLayout } from '@/config/expert-solution-layout';
import { parseGeometryExpression } from '@/lib/grid-geometry';

export function parseExpertNativeAngle(value: string) {
  const degrees = NATIVE.degreeSuffix.test(value);
  const parsed = parseGeometryExpression(value.replace(NATIVE.degreeSuffix, ''));
  if (!parsed.valid || parsed.value === null) return parsed;
  const angle = degrees ? (parsed.value / NATIVE.degreesPerHalfTurn) * Math.PI : parsed.value;

  return {
    valid: Number.isFinite(angle),
    value: Number.isFinite(angle) ? angle : null,
  };
}

function lineArc(arc: ExpertNativeArc, start: number, end: number) {
  const shape = expertSolutionLayout.numberLine;
  const y = shape.axis.y1;
  const direction = arc.sign === '-' ? 1 : -1;
  const curveY = y + direction * shape.curveAmplitude;
  const tailY = y + direction * shape.rayHeight;
  const handle = (end - start) * shape.curveHandleRatio;
  const rayHandle = (end - start) * shape.rayHandleRatio;
  const fromInfinite = arc.from === '-inf' || arc.from === '+inf';
  const toInfinite = arc.to === '-inf' || arc.to === '+inf';
  let path: string;

  if (start === end) {
    const width = NATIVE.line.loopWidth;
    const loopY = fromInfinite ? tailY : y;
    path = `M ${start} ${loopY} C ${start - width} ${curveY}, ${start + width} ${curveY}, ${end} ${loopY}`;
  } else if (fromInfinite && toInfinite) {
    path = `M ${start} ${tailY} L ${end} ${tailY}`;
  } else if (fromInfinite) {
    path = `M ${start} ${tailY} C ${start + rayHandle} ${tailY}, ${end} ${tailY}, ${end} ${y}`;
  } else if (toInfinite) {
    path = `M ${start} ${y} C ${start} ${tailY}, ${end - rayHandle} ${tailY}, ${end} ${tailY}`;
  } else {
    path = `M ${start} ${y} C ${start + handle} ${curveY}, ${end - handle} ${curveY}, ${end} ${y}`;
  }

  return {
    ...arc,
    start,
    end,
    path,
    loop: start === end,
    signX: start === end ? start + NATIVE.line.loopWidth : (start + end) / 2,
    signY: arc.sign === '-' ? shape.negativeSignY : shape.positiveSignY,
  };
}

export function buildExpertNativeNumberLine(value: ExpertNativeNumberLine) {
  const shape = expertSolutionLayout.numberLine;
  const config = NATIVE.line;
  const width = Math.max(
    config.minimumWidth,
    config.leftPadding + config.rightPadding + (value.points.length + 1) * config.pointGap,
  );
  const axis = { ...shape.axis, x1: config.leftPadding, x2: width - config.rightPadding };
  const gap = (axis.x2 - axis.x1) / (value.points.length + 1);
  const points = value.points.map((point, index) => ({ ...point, x: axis.x1 + (index + 1) * gap }));
  const positions = new Map(points.map((point) => [point.id, point.x]));
  const endpoint = (id: string) =>
    id === '-inf' ? axis.x1 : id === '+inf' ? axis.x2 : positions.get(id);
  const arcs = value.arcs.flatMap((arc, index) => {
    const from = endpoint(arc.from);
    const to = endpoint(arc.to);
    return from === undefined || to === undefined ? [] : [{ ...lineArc(arc, from, to), index }];
  });

  return {
    width,
    viewBox: `0 0 ${width} ${config.height}`,
    axis,
    arrow: `M ${axis.x2 - config.arrowWidth} ${axis.y1 - config.arrowHeight} L ${axis.x2} ${axis.y1} L ${axis.x2 - config.arrowWidth} ${axis.y1 + config.arrowHeight}`,
    variable: {
      x: axis.x2 + config.variableOffset,
      y: axis.y1 + config.arrowHeight - config.variableLabel.height / 2,
      ...config.variableLabel,
    },
    points,
    arcs,
    missingArcs: value.arcs.length - arcs.length,
  };
}

function circlePosition(angle: number, radius: number) {
  const { center, fullTurn } = expertSolutionLayout.circleGeometry;
  const normalized = angle % fullTurn;
  return {
    x: center.x + Math.cos(normalized) * radius,
    y: center.y - Math.sin(normalized) * radius,
  };
}

function circleArc(arc: ExpertNativeCircleArc, from: number, to: number) {
  const { radius, fullTurn, halfTurn } = expertSolutionLayout.circleGeometry;
  const start = circlePosition(from, radius);
  const end = circlePosition(to, radius);
  const direction = arc.direction === 'ccw' ? 1 : -1;
  // Разность двух конечных больших углов тоже может переполниться.
  const fromAngle = from % fullTurn;
  const toAngle = to % fullTurn;
  const rawSpan = direction * (toAngle - fromAngle);
  const span = arc.full_circle ? fullTurn : ((rawSpan % fullTurn) + fullTurn) % fullTurn;
  const sweep = arc.direction === 'ccw' ? 0 : 1;
  const middle = fromAngle + (direction * span) / 2;
  const signPosition = circlePosition(middle, NATIVE.circle.signRadius);
  let path: string;

  if (arc.full_circle) {
    const opposite = circlePosition(fromAngle + halfTurn, radius);
    path = `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 0 ${sweep} ${start.x} ${start.y}`;
  } else {
    path = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${span > halfTurn ? 1 : 0} ${sweep} ${end.x} ${end.y}`;
  }

  return {
    ...arc,
    path,
    signPosition,
  };
}

export function buildExpertNativeUnitCircle(value: ExpertNativeUnitCircle) {
  const { radius, labelRadius, labelBox } = expertSolutionLayout.circleGeometry;
  const parsed = value.points.map((point) => ({
    point,
    angle: parseExpertNativeAngle(point.value),
  }));
  const points = parsed.flatMap(({ point, angle }) => {
    if (!angle.valid || angle.value === null) return [];
    const label = circlePosition(angle.value, labelRadius);

    return [
      {
        ...point,
        angle: angle.value,
        ...circlePosition(angle.value, radius),
        signPosition: circlePosition(angle.value, NATIVE.circle.pointSignRadius),
        labelX: label.x - labelBox.width / 2,
        labelY: label.y - labelBox.height / 2,
      },
    ];
  });
  const angles = new Map(points.map((point) => [point.id, point.angle]));
  const arcs = value.arcs.flatMap((arc, index) => {
    const from = angles.get(arc.from);
    const to = angles.get(arc.to);
    return from === undefined || to === undefined ? [] : [{ ...circleArc(arc, from, to), index }];
  });

  return {
    points,
    arcs,
    unknownPoints: parsed.filter(({ angle }) => !angle.valid).map(({ point }) => point),
    missingArcs: value.arcs.length - arcs.length,
  };
}
