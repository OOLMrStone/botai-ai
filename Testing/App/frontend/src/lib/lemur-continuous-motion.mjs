const TAU = 2 * Math.PI;
const wrap = (value) => ((value % 1) + 1) % 1;
const smooth = (value) => value ** 3 * (10 + value * (-15 + value * 6));

// Скорость в начале и конце переноса совпадает со скоростью опорной стопы.
function swingTravel(value, stance) {
  const tangent = (-2 * (1 - stance)) / stance;
  return -1 + 6 * value ** 2 - 4 * value ** 3 + tangent * (2 * value ** 3 - 3 * value ** 2 + value);
}

export function bodyPose(phase, config) {
  const start = config.body.phaseOffset;
  const position = phase + start;
  const headStart = start - config.body.headLag;

  return {
    x: config.body.x * (Math.sin(TAU * position) - Math.sin(TAU * start)),
    y: config.body.y * (Math.cos(2 * TAU * position) - Math.cos(2 * TAU * start)),
    headY:
      config.body.headAmplitude *
      config.body.y *
      (Math.cos(2 * TAU * (phase + headStart)) - Math.cos(2 * TAU * headStart)),
    headAngle:
      config.body.headTilt * (Math.sin(TAU * (phase + headStart)) - Math.sin(TAU * headStart)),
  };
}

export function footPose(phase, leg, config) {
  const local = legPhase(phase, leg, config);
  const shape = config.legShapes[leg.shape];
  const grounded = local < config.stance;
  const progress = grounded ? local / config.stance : (local - config.stance) / (1 - config.stance);
  const travel = grounded ? 1 - 2 * progress : swingTravel(progress, config.stance);
  const travelShape = config.leg.travelByShape[leg.shape];
  const lift = grounded ? 0 : travelShape.lift * 16 * progress ** 2 * (1 - progress) ** 2;
  const roll = config.leg.toeRoll;
  const toeAngle = leg.shape === roll.shape ? keyedValue(local, roll.keys) : 0;
  const base = soleSupport(shape.silhouette, 0, shape.referenceFoot);
  const toe = soleSupport(shape.silhouette, toeAngle, shape.referenceFoot);
  const x = leg.neutralX + travelShape.reach + (config.stride * travel) / 2;
  const y = config.shadow.y - base.rotated[1] - lift;

  return {
    x: x + base.rotated[0] - toe.rotated[0],
    y: y + base.rotated[1] - toe.rotated[1],
    lift,
    grounded,
    toeAngle,
    toe: toe.source,
    contact: { x: x + base.rotated[0], y: y + base.rotated[1] },
    angle:
      toeAngle +
      (grounded
        ? 0
        : -config.leg.pawPitch * Math.sin(TAU * progress) * Math.sin(Math.PI * progress)),
  };
}

function keyedValue(position, keys) {
  const index = keys.findIndex((key) => key[0] > position);
  const from = keys[index - 1];
  const to = keys[index];
  return from[1] + (to[1] - from[1]) * smooth((position - from[0]) / (to[0] - from[0]));
}

// Контакт следует по округлой подошве: поворот не сдвигает опорный носок по полу.
function soleSupport(data, degrees, pivot) {
  const values = data.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const angle = (degrees * Math.PI) / 180;
  const rotate = ([x, y]) => [
    (x - pivot.x) * Math.cos(angle) - (y - pivot.y) * Math.sin(angle),
    (x - pivot.x) * Math.sin(angle) + (y - pivot.y) * Math.cos(angle),
  ];
  let start = values.slice(0, 2);
  let support = { source: start, rotated: rotate(start) };
  for (let index = 2; index < values.length; index += 6) {
    const points = [
      start,
      values.slice(index, index + 2),
      values.slice(index + 2, index + 4),
      values.slice(index + 4, index + 6),
    ];
    const ys = points.map((point) => rotate(point)[1]);
    const a = -ys[0] + 3 * ys[1] - 3 * ys[2] + ys[3];
    const b = 2 * (ys[0] - 2 * ys[1] + ys[2]);
    const c = ys[1] - ys[0];
    const discriminant = b * b - 4 * a * c;
    const roots =
      Math.abs(a) < 1e-10
        ? Math.abs(b) < 1e-10
          ? []
          : [-c / b]
        : discriminant < 0
          ? []
          : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
    for (const t of [0, 1, ...roots.filter((value) => value > 0 && value < 1)]) {
      const weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
      const source = [0, 1].map((axis) =>
        points.reduce((sum, point, k) => sum + point[axis] * weights[k], 0),
      );
      const rotated = rotate(source);
      if (rotated[1] > support.rotated[1]) support = { source, rotated };
    }
    start = points[3];
  }
  return support;
}

export function blinkAmount(phase, config) {
  const distance = Math.abs(phase - config.blink.center) / config.blink.halfWidth;
  return distance >= 1 ? 0 : smooth(1 - distance);
}

export function headPose(phase, config) {
  const position = wrap(phase);
  const keys = config.headTurn.keys;
  const index = keys.findIndex((key) => key[0] > position);
  const from = keys[index - 1];
  const to = keys[index];
  const progress = smooth((position - from[0]) / (to[0] - from[0]));
  const turn = from[1] + (to[1] - from[1]) * progress;
  const expression =
    (turn - config.headTurn.smileStart) / (config.headTurn.smileEnd - config.headTurn.smileStart);

  return {
    turn,
    smile: config.mouth.smileIntensity * (1 - smooth(Math.max(0, Math.min(1, expression)))),
  };
}

export function tailPoint(position, phase, config) {
  const body = bodyPose(phase, config);
  const inverse = 1 - position;
  const weights = [
    inverse ** 3,
    3 * inverse ** 2 * position,
    3 * inverse * position ** 2,
    position ** 3,
  ];
  const point = config.tail.points.reduce(
    (sum, entry, index) => [sum[0] + entry[0] * weights[index], sum[1] + entry[1] * weights[index]],
    [0, 0],
  );
  const wave = TAU * (config.tail.cycles * phase - config.tail.lag * position);

  return [
    point[0] + body.x + config.tail.sway * position ** 1.7 * Math.sin(wave),
    point[1] + body.y + config.tail.lift * position ** 2 * Math.cos(wave),
  ];
}

export function legPhase(phase, leg, config) {
  const side = leg.far ? 'far' : 'near';
  const lag = leg.shape === 'front' ? config.leg.frontPhaseLag[side] : 0;
  const offset = config.leg.sidePhaseOffset[side] + lag;

  return wrap(phase + config.phaseOffset - offset);
}

export function legContour(phase, leg, config, part = 'silhouette') {
  const position = legPhase(phase, leg, config);
  const anatomy = config.legShapes[leg.shape];
  const keys = anatomy.articulation.keys;
  const index = keys.findIndex((key) => key[0] > position);
  const from = keys[index - 1];
  const to = keys[index];
  const amount = smooth((position - from[0]) / (to[0] - from[0]));
  const shape = (name) =>
    name === 'reference'
      ? anatomy[part]
      : (anatomy.articulation.shapes[name][part] ?? anatomy[part]);
  const target = shape(to[1])
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number);
  let coordinate = 0;

  return shape(from[1]).replace(/-?\d+(?:\.\d+)?/g, (value) =>
    String(Number(value) + (target[coordinate++] - Number(value)) * amount),
  );
}

function legWeight(progress, shape) {
  const ramp = shape.deformRamp;
  if (ramp === undefined) return smooth(progress);
  if (progress > 1 - ramp) return 1 - legWeight(1 - progress, shape);
  if (progress < ramp)
    return (progress ** 3 / ramp ** 2 - progress ** 4 / (2 * ramp ** 3)) / (1 - ramp);
  return (progress - ramp / 2) / (1 - ramp);
}

function deformPoint(point, body, foot, leg, config) {
  const shape = config.legShapes[leg.shape];
  const reference = shape.referenceFoot;
  const offset = leg.far ? config.leg.farOffset : [0, 0];
  const end = reference.y - shape.pawHeight;
  const progress = Math.max(
    0,
    Math.min(1, (point[1] - shape.deformStartY) / (end - shape.deformStartY)),
  );
  const weight = legWeight(progress, shape);
  const angle = ((foot.angle - reference.angle) * Math.PI * weight) / 180;
  const dx = point[0] - reference.x;
  const dy = point[1] - reference.y;

  return [
    reference.x +
      dx * Math.cos(angle) -
      dy * Math.sin(angle) +
      (foot.x - reference.x) * weight +
      (body.x + offset[0]) * (1 - weight),
    reference.y +
      dx * Math.sin(angle) +
      dy * Math.cos(angle) +
      (foot.y - reference.y) * weight +
      (body.y + offset[1]) * (1 - weight),
  ];
}

function contourAxis(data, shape) {
  const values = data.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const curves = [];
  let start = values.slice(0, 2);
  for (let index = 2; index < values.length; index += 6) {
    const curve = [
      start,
      values.slice(index, index + 2),
      values.slice(index + 2, index + 4),
      values.slice(index + 4, index + 6),
    ];
    curves.push(curve);
    start = curve[3];
  }
  const begin = shape.deformStartY;
  const end = shape.referenceFoot.y - shape.pawHeight;
  const count = shape.volumeAxisSamples;
  const step = (end - begin) / count;
  const centers = [];
  const cubic = (curve, t, axis) =>
    (1 - t) ** 3 * curve[0][axis] +
    3 * (1 - t) ** 2 * t * curve[1][axis] +
    3 * (1 - t) * t * t * curve[2][axis] +
    t ** 3 * curve[3][axis];
  for (let index = 0; index <= count; index++) {
    const y = begin + index * step;
    const crossings = [];
    for (const curve of curves) {
      if (y < Math.min(curve[0][1], curve[3][1]) || y > Math.max(curve[0][1], curve[3][1]))
        continue;
      let low = 0,
        high = 1;
      for (let iteration = 0; iteration < 40; iteration++) {
        const t = (low + high) / 2;
        if (cubic(curve, t, 1) < y === curve[0][1] < curve[3][1]) low = t;
        else high = t;
      }
      crossings.push(cubic(curve, (low + high) / 2, 0));
    }
    centers.push((Math.min(...crossings) + Math.max(...crossings)) / 2);
  }
  const second = Array(count + 1).fill(0),
    upper = Array(count + 1).fill(0);
  for (let index = 1; index < count; index++) {
    const denominator = 4 - upper[index - 1];
    upper[index] = 1 / denominator;
    second[index] =
      ((6 * (centers[index + 1] - 2 * centers[index] + centers[index - 1])) / step ** 2 -
        second[index - 1]) /
      denominator;
  }
  for (let index = count - 1; index > 0; index--) second[index] -= upper[index] * second[index + 1];
  return (y) => {
    const index = Math.max(0, Math.min(count - 1, Math.floor((y - begin) / step)));
    const t = (y - begin - index * step) / step,
      a = 1 - t;
    return (
      a * centers[index] +
      t * centers[index + 1] +
      (((a ** 3 - a) * second[index] + (t ** 3 - t) * second[index + 1]) * step ** 2) / 6
    );
  };
}

function legMapper(phase, leg, config) {
  const body = bodyPose(phase, config);
  const foot = footPose(phase, leg, config);
  const shape = config.legShapes[leg.shape];
  const axis = shape.volumeAxisSamples ? contourAxis(legContour(phase, leg, config), shape) : null;
  return (point) => {
    const mapped = deformPoint(point, body, foot, leg, config);
    const end = shape.referenceFoot.y - shape.pawHeight;
    if (!axis || point[1] >= end || point[1] <= shape.deformStartY) return mapped;
    const y = point[1],
      step = 0.01;
    const center = [axis(y), y];
    const before = deformPoint([axis(y - step), y - step], body, foot, leg, config);
    const after = deformPoint([axis(y + step), y + step], body, foot, leg, config);
    const tangent = after.map((value, index) => value - before[index]);
    const length = Math.hypot(...tangent);
    const normal = [tangent[1] / length, -tangent[0] / length];
    const origin = deformPoint(center, body, foot, leg, config);
    const sourceSlope = (axis(y + step) - axis(y - step)) / (2 * step);
    const expected = (point[0] - center[0]) / Math.hypot(1, sourceSlope);
    const actual = (mapped[0] - origin[0]) * normal[0] + (mapped[1] - origin[1]) * normal[1];
    // Меняется только поперечная толщина; продольная составляющая сгиба остаётся прежней.
    return mapped.map((value, index) => value + normal[index] * (expected - actual));
  };
}

export function legPoint(point, phase, leg, config) {
  return legMapper(phase, leg, config)(point);
}

export function legPath(phase, leg, config, part = 'silhouette') {
  const map = legMapper(phase, leg, config);
  const values = legContour(phase, leg, config, part)
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number);
  let start = values.slice(0, 2);
  const pair = (point) => point.map(String).join(' ');
  const result = [`M ${pair(map(start))}`];
  const count = config.leg.contourSubdivisions;
  for (let index = 2; index < values.length; index += 6) {
    const points = [
      start,
      values.slice(index, index + 2),
      values.slice(index + 2, index + 4),
      values.slice(index + 4, index + 6),
    ];
    const sample = (t) => {
      const weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
      const point = [0, 1].map((axis) =>
        points.reduce((sum, p, k) => sum + p[axis] * weights[k], 0),
      );
      const tangent = [0, 1].map(
        (axis) =>
          3 *
          ((1 - t) ** 2 * (points[1][axis] - points[0][axis]) +
            2 * (1 - t) * t * (points[2][axis] - points[1][axis]) +
            t * t * (points[3][axis] - points[2][axis])),
      );
      const shape = config.legShapes[leg.shape];
      const footStart = shape.referenceFoot.y - shape.pawHeight;
      if (point[1] >= footStart || point[1] <= shape.deformStartY) {
        const angle =
          point[1] >= footStart ? (footPose(phase, leg, config).angle * Math.PI) / 180 : 0;
        return {
          point: map(point),
          tangent: [
            tangent[0] * Math.cos(angle) - tangent[1] * Math.sin(angle),
            tangent[0] * Math.sin(angle) + tangent[1] * Math.cos(angle),
          ],
        };
      }
      const epsilon = 0.0001;
      const before = map(point.map((value, axis) => value - epsilon * tangent[axis]));
      const after = map(point.map((value, axis) => value + epsilon * tangent[axis]));
      return {
        point: map(point),
        tangent: after.map((value, axis) => (value - before[axis]) / (2 * epsilon)),
      };
    };
    let from = sample(0);
    for (let section = 1; section <= count; section++) {
      const to = sample(section / count);
      const first = from.point.map((value, axis) => value + from.tangent[axis] / (3 * count));
      const second = to.point.map((value, axis) => value - to.tangent[axis] / (3 * count));
      result.push(`C ${pair(first)} ${pair(second)} ${pair(to.point)}`);
      from = to;
    }
    start = points[3];
  }
  return `${result.join(' ')} Z`;
}
