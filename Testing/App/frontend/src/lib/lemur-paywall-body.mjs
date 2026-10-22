import { paywallGesture, paywallFace } from './lemur-paywall-motion.mjs';

function ramp(value, start, end) {
  const phase = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return phase * phase * (3 - 2 * phase);
}

export function paywallBodyPose(time, config) {
  const body = config.body;
  const breath = (1 - Math.cos((time / body.breathPeriod) * Math.PI * 2)) / 2;
  const gesture = paywallGesture(time, config);
  const gaze = paywallFace(time, config).gaze;
  const tail =
    Math.sin((time / body.tailPeriod) * Math.PI * 2 - body.tailPhase) + Math.sin(body.tailPhase);

  return { breath, gesture, gaze, tail };
}

export function paywallBodyBasis(x, y, config) {
  const body = config.body;
  const ground = 1 - ramp(y, ...body.groundFade);
  const [a, b, c, d] = body.torsoX;
  const torso = ramp(x, a, b) * (1 - ramp(x, c, d)) * ground;
  const head = ramp(x, ...body.headX) * (1 - ramp(y, ...body.headFade));
  const tail = (1 - ramp(x, ...body.tailX)) * (1 - ramp(y, ...body.tailFade));
  const [hx, hy] = body.headPivot;
  const [tx, ty] = body.tailPivot;

  return [
    ((x - (b + c) / 2) / (c - b)) * torso * body.bellyWidth,
    -torso * body.breathLift - head * body.headLift,
    -(y - hy) * head * body.nodRadians,
    (x - hx) * head * body.nodRadians - torso * body.gestureLift,
    -(y - ty) * tail * body.tailRadians,
    (x - tx) * tail * body.tailRadians,
  ];
}

export function preparePaywallBody(info, config) {
  const [left, top, right, bottom] = config.body.region;
  const entries = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const basis = paywallBodyBasis(x, y, config);
      if (basis.every((value) => value === 0)) continue;
      entries.push(x, y, (y * info.width + x) * info.channels, ...basis);
    }
  }

  return new Float32Array(entries);
}

export function renderPaywallBody(source, info, field, pose) {
  if (Object.values(pose).every((value) => value === 0)) return source;
  const target = Buffer.from(source);
  const stride = 9;
  const nod = pose.gesture - pose.gaze;

  for (let index = 0; index < field.length; index += stride) {
    const x =
      field[index] -
      field[index + 3] * pose.breath -
      field[index + 5] * nod -
      field[index + 7] * pose.tail;
    const y =
      field[index + 1] -
      field[index + 4] * pose.breath -
      field[index + 6] * nod -
      field[index + 8] * pose.tail;
    const targetOffset = field[index + 2];
    const left = Math.floor(x);
    const top = Math.floor(y);
    const fx = x - left;
    const fy = y - top;
    const sourceOffset = (top * info.width + left) * info.channels;
    const nextRow = sourceOffset + info.width * info.channels;

    for (let channel = 0; channel < info.channels; channel++) {
      const upper =
        source[sourceOffset + channel] * (1 - fx) +
        source[sourceOffset + info.channels + channel] * fx;
      const lower =
        source[nextRow + channel] * (1 - fx) + source[nextRow + info.channels + channel] * fx;
      target[targetOffset + channel] = Math.round(upper * (1 - fy) + lower * fy);
    }
  }

  return target;
}
