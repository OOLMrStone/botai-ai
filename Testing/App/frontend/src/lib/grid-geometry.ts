import { EXPERT_GEOMETRY, EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import type { ExpertNumberLine, ExpertNumberLinePoint, ExpertUnitCircle } from '@/config/expert';

export function parseGeometryNumber(text: string, optional = false) {
  const value = text
    .trim()
    .replaceAll(' ', '')
    .replaceAll(',', '.')
    .replaceAll('pi', 'π')
    .replaceAll('−', '-');
  if (!value) return { valid: optional, value: null };

  const pi = value.match(EXPERT_GEOMETRY.piPattern);
  const fraction = value.match(EXPERT_GEOMETRY.fractionPattern);
  let result: number;

  if (pi) {
    const coefficient = pi[1] === '' || pi[1] === '+' ? 1 : pi[1] === '-' ? -1 : Number(pi[1]);
    result = (coefficient * Math.PI) / Number(pi[2] ?? 1);
  } else if (fraction) {
    result = Number(fraction[1]) / Number(fraction[2]);
  } else if (EXPERT_GEOMETRY.decimalPattern.test(value)) {
    result = Number(value);
  } else {
    return { valid: false, value: null };
  }

  return { valid: Number.isFinite(result), value: Number.isFinite(result) ? result : null };
}

export function parseGeometryExpression(text: string) {
  if (text.length > EXPERT_GEOMETRY.maximumExpressionLength) return { valid: false, value: null };

  const source = text
    .replace(/\\(?:left|right)/g, '')
    .replace(/\\(?:dfrac|tfrac)/g, '\\frac')
    .replace(/\\pi|pi/g, 'π')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/\\[,!; ]|\s/g, '')
    .replaceAll('−', '-')
    .replaceAll(',', '.');
  let cursor = 0;
  let finiteExpression = true;
  const finite = (value: number) => {
    if (!Number.isFinite(value)) finiteExpression = false;
    return value;
  };
  const readAtom = (depth: number): number => {
    if (depth > EXPERT_GEOMETRY.maximumExpressionDepth) return NaN;
    const token = source[cursor];
    if (source.startsWith('\\sqrt', cursor)) {
      cursor += '\\sqrt'.length;
      let degree = 2;
      if (source[cursor] === '[') {
        cursor += 1;
        degree = expression(depth + 1);
        if (source[cursor++] !== ']') return NaN;
      }
      const radicand = atom(depth + 1);
      if (degree === 0) return NaN;
      return radicand < 0 && Number.isInteger(degree) && Math.abs(degree % 2) === 1
        ? -Math.pow(-radicand, 1 / degree)
        : Math.pow(radicand, 1 / degree);
    }
    const functionName = source.slice(cursor).match(/^\\(sin|cos|tan|cot|ln|lg|log)/)?.[1];
    if (functionName) {
      cursor += functionName.length + 1;
      let base = 10;
      if (functionName === 'log' && source[cursor] === '_') {
        cursor += 1;
        base = atom(depth + 1);
      }
      const argument = atom(depth + 1);
      switch (functionName) {
        case 'sin':
          return Math.sin(argument);
        case 'cos':
          return Math.cos(argument);
        case 'tan':
          return Math.abs(Math.cos(argument)) < EXPERT_GEOMETRY.angleTolerance
            ? NaN
            : Math.tan(argument);
        case 'cot':
          return Math.abs(Math.sin(argument)) < EXPERT_GEOMETRY.angleTolerance
            ? NaN
            : 1 / Math.tan(argument);
        case 'ln':
          return Math.log(argument);
        default:
          return base > 0 && base !== 1 ? Math.log(argument) / Math.log(base) : NaN;
      }
    }
    if (source.startsWith('\\frac', cursor)) {
      cursor += '\\frac'.length;
      if (source[cursor] !== '{') return NaN;
      const numerator = atom(depth + 1);
      if (source[cursor] !== '{') return NaN;
      return numerator / atom(depth + 1);
    }
    if (token === '{' || token === '(') {
      cursor += 1;
      const value = expression(depth + 1);
      if (source[cursor] !== (token === '{' ? '}' : ')')) return NaN;
      cursor += 1;
      return value;
    }
    if (token === 'e') {
      cursor += 1;
      return Math.E;
    }
    if (token === 'π') {
      cursor += 1;
      return Math.PI;
    }
    const number = source.slice(cursor).match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
    if (!number) return NaN;
    cursor += number.length;
    return Number(number);
  };
  const atom = (depth: number): number => finite(readAtom(depth));
  const power = (depth: number): number => {
    if (depth > EXPERT_GEOMETRY.maximumExpressionDepth) return NaN;
    const value = atom(depth);
    if (source[cursor] !== '^') return value;
    cursor += 1;
    return finite(Math.pow(value, unary(depth + 1)));
  };
  const unary = (depth: number): number => {
    if (depth > EXPERT_GEOMETRY.maximumExpressionDepth) return NaN;
    if (source[cursor] === '+' || source[cursor] === '-') {
      const negative = source[cursor++] === '-';
      return finite((negative ? -1 : 1) * unary(depth + 1));
    }
    return power(depth);
  };
  const product = (depth: number): number => {
    let value = unary(depth);
    while (cursor < source.length) {
      const token = source[cursor];
      if (token === '*' || token === '/') {
        cursor += 1;
        const right = unary(depth);
        value = finite(token === '*' ? value * right : value / right);
      } else if (
        token === 'π' ||
        token === 'e' ||
        token === '(' ||
        token === '{' ||
        token === '\\'
      ) {
        const start = cursor;
        value = finite(value * unary(depth));
        if (start === cursor) return NaN;
      } else break;
    }
    return value;
  };
  const expression = (depth: number): number => {
    let value = product(depth);
    while (source[cursor] === '+' || source[cursor] === '-') {
      const operation = source[cursor++];
      const right = product(depth);
      value = finite(operation === '+' ? value + right : value - right);
    }
    return value;
  };
  const value = expression(0);
  const valid = finiteExpression && cursor === source.length && Number.isFinite(value);

  return { valid, value: valid ? value : null };
}

export function geometryPointExpression(point: ExpertNumberLinePoint) {
  const parsed = parseGeometryExpression(point.label);
  return parsed.valid &&
    parsed.value !== null &&
    Math.abs(parsed.value - point.value) < EXPERT_GEOMETRY.angleTolerance
    ? point.label
    : String(point.value);
}

export function formatGeometryCoordinate(value: number) {
  const rounded = Number(value.toPrecision(EXPERT_GEOMETRY.coordinatePrecision));
  const label = new Intl.NumberFormat(EXPERT_GEOMETRY.coordinateLocale, {
    maximumSignificantDigits: EXPERT_GEOMETRY.coordinatePrecision,
  }).format(value);
  return rounded === value ? label : EXPERT_GEOMETRY_COPY.approximate(label);
}

export function geometryCircleAngleValue(point: ExpertUnitCircle['points'][number]) {
  const parsed = parseGeometryExpression(point.label);

  return parsed.valid &&
    parsed.value !== null &&
    Math.abs(parsed.value - point.angle) < EXPERT_GEOMETRY.angleTolerance
    ? point.label
    : formatGeometryAngle(point.angle).replace(EXPERT_GEOMETRY.piSymbol, EXPERT_GEOMETRY.piCommand);
}

export function formatGeometryAngle(value: number) {
  if (value === 0) return String(value);

  for (const denominator of EXPERT_GEOMETRY.angleDenominators) {
    const numerator = Math.round((value / Math.PI) * denominator);
    if (Math.abs(value - (numerator * Math.PI) / denominator) >= EXPERT_GEOMETRY.angleTolerance)
      continue;

    const coefficient = numerator === 1 ? '' : numerator === -1 ? '-' : String(numerator);
    return `${coefficient}${EXPERT_GEOMETRY.piSymbol}${denominator === 1 ? '' : `/${denominator}`}`;
  }

  return String(value);
}

export function patchGeometryItem<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function pointHasUniqueValue(points: ExpertNumberLinePoint[], point: ExpertNumberLinePoint) {
  return !points.some((candidate) => candidate.id !== point.id && candidate.value === point.value);
}

export function updateGeometryPoint(
  axis: ExpertNumberLine,
  id: string,
  patch: Partial<ExpertNumberLinePoint>,
): ExpertNumberLine {
  const previous = axis.points.find((point) => point.id === id);
  const nextValue = patch.value;
  const moving = previous && nextValue !== undefined && Number.isFinite(nextValue);
  const ownsBoundaries = previous && pointHasUniqueValue(axis.points, previous);
  const padding = Math.max(
    (axis.max - axis.min) * EXPERT_GEOMETRY.rangePaddingRatio,
    EXPERT_GEOMETRY.minimumRangePadding,
  );

  return {
    ...axis,
    min: moving && nextValue < axis.min ? nextValue - padding : axis.min,
    max: moving && nextValue > axis.max ? nextValue + padding : axis.max,
    intervals:
      moving && ownsBoundaries
        ? axis.intervals.map((interval) => ({
            ...interval,
            from: interval.from === previous.value ? nextValue : interval.from,
            to: interval.to === previous.value ? nextValue : interval.to,
          }))
        : axis.intervals,
    points: patchGeometryItem(axis.points, id, {
      ...patch,
      ...(moving && patch.label === undefined && previous.label === String(previous.value)
        ? { label: String(nextValue) }
        : {}),
      ...(patch.included !== undefined ? { marker: patch.included ? 'closed' : 'open' } : {}),
    }),
    selectedPoints:
      patch.included === false
        ? axis.selectedPoints.filter((pointId) => pointId !== id)
        : axis.selectedPoints,
  };
}

export function selectGeometryPoint(
  axis: ExpertNumberLine,
  id: string,
  selected: boolean,
): ExpertNumberLine {
  return {
    ...axis,
    points: selected
      ? patchGeometryItem(axis.points, id, { included: true, marker: 'closed' })
      : axis.points,
    selectedPoints: selected
      ? [...new Set([...axis.selectedPoints, id])]
      : axis.selectedPoints.filter((pointId) => pointId !== id),
  };
}

export function updateGeometryCirclePoint(
  circle: ExpertUnitCircle,
  id: string,
  patch: Partial<ExpertUnitCircle['points'][number]>,
): ExpertUnitCircle {
  const previous = circle.points.find((point) => point.id === id);
  const nextAngle = patch.angle;
  const moving = previous && nextAngle !== undefined && Number.isFinite(nextAngle);
  const angleLabel = (angle: number) =>
    formatGeometryAngle(angle).replace(EXPERT_GEOMETRY.piSymbol, EXPERT_GEOMETRY.piCommand);
  const defaultLabel =
    previous &&
    [
      String(previous.angle),
      formatGeometryAngle(previous.angle),
      angleLabel(previous.angle),
    ].includes(previous.label);

  return {
    ...circle,
    points: patchGeometryItem(circle.points, id, {
      ...patch,
      ...(moving && patch.label === undefined && defaultLabel
        ? { label: angleLabel(nextAngle) }
        : {}),
      ...(patch.selected !== undefined ? { marker: patch.selected ? 'closed' : 'open' } : {}),
    }),
    arcs: moving
      ? circle.arcs.map((arc) => ({
          ...arc,
          from: circleEndpointMatches(arc, 'from', previous) ? nextAngle : arc.from,
          to: circleEndpointMatches(arc, 'to', previous) ? nextAngle : arc.to,
        }))
      : circle.arcs,
  };
}

function circleEndpointMatches(
  arc: ExpertUnitCircle['arcs'][number],
  side: 'from' | 'to',
  point: ExpertUnitCircle['points'][number],
) {
  const pointId = side === 'from' ? arc.fromPointId : arc.toPointId;

  return pointId === undefined ? arc[side] === point.angle : pointId === point.id;
}

export function geometryCircleArcUsesPoint(
  arc: ExpertUnitCircle['arcs'][number],
  point: ExpertUnitCircle['points'][number],
) {
  return circleEndpointMatches(arc, 'from', point) || circleEndpointMatches(arc, 'to', point);
}

export function setGeometryCircleEndpoint(
  circle: ExpertUnitCircle,
  id: string,
  side: 'from' | 'to',
  angle: number,
  pointId?: string,
): ExpertUnitCircle {
  return {
    ...circle,
    arcs: circle.arcs.map((arc) => {
      if (arc.id !== id) return arc;
      const from = side === 'from' ? angle : arc.from;
      const to = side === 'to' ? angle : arc.to;
      const fromPointId = side === 'from' ? pointId : arc.fromPointId;
      const toPointId = side === 'to' ? pointId : arc.toPointId;

      return {
        ...arc,
        from,
        to,
        fromPointId,
        toPointId,
        fullCircle:
          fromPointId !== undefined && toPointId !== undefined
            ? fromPointId === toPointId
            : from === to,
      };
    }),
  };
}

export function removeGeometryPoint(axis: ExpertNumberLine, id: string): ExpertNumberLine {
  const point = axis.points.find((candidate) => candidate.id === id);
  const points = axis.points.filter((candidate) => candidate.id !== id);
  const ownsBoundaries = point && pointHasUniqueValue(axis.points, point);

  return {
    ...axis,
    points,
    selectedPoints: axis.selectedPoints.filter((pointId) => pointId !== id),
    intervals: ownsBoundaries
      ? axis.intervals.filter(
          (interval) => interval.from !== point.value && interval.to !== point.value,
        )
      : axis.intervals,
  };
}

export function removeGeometryCirclePoint(circle: ExpertUnitCircle, id: string): ExpertUnitCircle {
  const point = circle.points.find((candidate) => candidate.id === id);

  return {
    ...circle,
    points: circle.points.filter((candidate) => candidate.id !== id),
    arcs: point
      ? circle.arcs.filter((arc) => !geometryCircleArcUsesPoint(arc, point))
      : circle.arcs,
  };
}
