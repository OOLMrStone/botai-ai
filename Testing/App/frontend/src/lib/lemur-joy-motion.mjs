import { animationChannel } from './animation-channel.mjs';

const mix = (a, b, t) => a + (b - a) * t;
const pointMix = (a, b, t) => a.map((value, index) => mix(value, b[index], t));
const smoothUnit = (value) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

export function joyPose(time, motion) {
  const pose = Object.fromEntries(
    Object.entries(motion.channels).map(([name, keys]) => [name, animationChannel(time, keys)]),
  );
  const idle =
    time >= motion.restLoopStart
      ? (1 - Math.cos((2 * Math.PI * (time - motion.restLoopStart)) / motion.restPeriod)) / 2
      : 0;
  const { start, riseEnd, fallStart, end, height } = motion.flight;
  const airborne = time > start && time < end;
  let lift = 0;
  if (airborne) {
    if (time < riseEnd) {
      const rising = (time - start) / (riseEnd - start);
      lift = height * (1 - (1 - rising) ** 2);
    } else if (time > fallStart) {
      const falling = (time - fallStart) / (end - fallStart);
      lift = height * (1 - falling ** 2);
    } else {
      lift = height;
    }
  }

  return {
    ...pose,
    idle,
    crouch: pose.crouch + idle * motion.idle.crouch,
    headTilt: pose.headTilt + idle * motion.idle.headTilt,
    tail: pose.tail + idle * motion.idle.tail,
    airborne,
    lift,
    y: (pose.crouch + idle * motion.idle.crouch) * motion.crouchDepth - lift,
  };
}

export function joyLimb(limb, kind, time, pose, motion) {
  const raised =
    kind === 'arm'
      ? animationChannel(time - limb.delay, motion.channels.arms) + pose.idle * motion.idle.arms
      : pose.legs;
  const end = pointMix(limb.end, limb.raisedEnd, raised);

  if (kind === 'leg') {
    end[1] -= pose.crouch * motion.crouchDepth;
    return { end, angle: raised * limb.raisedAngle, pawPath: limb.pawPath };
  }

  return {
    foregroundStart: limb.rootCover,
    foregroundTaperStrength: Math.max(0, Math.min(1, raised)),
    root: limb.root,
    bend: pointMix(limb.bend, limb.raisedBend, raised),
    surfaceEnd: end,
    end,
    radii: limb.radii,
    paw: limb.paw,
    angle: limb.paw[2] * (1 - raised),
  };
}

export function joyBodyPath(source, target, pose, art, motion) {
  const values = target.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let index = 0;

  return source.replace(/-?\d+(?:\.\d+)?/g, (value) => {
    const coordinate = mix(Number(value), values[index], pose.legs);
    const isY = index++ % 2;
    if (!isY) {
      return String(coordinate);
    }

    const [start, end] = art.body.crouchRange;
    const t = Math.min(1, Math.max(0, (coordinate - start) / (end - start)));
    const weight = smoothUnit(t);
    return String(coordinate - pose.crouch * motion.crouchDepth * weight);
  });
}

export function quadraticPoint(points, t) {
  return points[0].map(
    (_, axis) =>
      (1 - t) ** 2 * points[0][axis] + 2 * t * (1 - t) * points[1][axis] + t ** 2 * points[2][axis],
  );
}

function cubicPoint(points, t) {
  return points[0].map(
    (_, axis) =>
      (1 - t) ** 3 * points[0][axis] +
      3 * t * (1 - t) ** 2 * points[1][axis] +
      3 * t ** 2 * (1 - t) * points[2][axis] +
      t ** 3 * points[3][axis],
  );
}

export function joyTailRadius(t, art) {
  const [root, tip] = art.tail.radii;
  return root + (tip - root) * Math.sin((t * Math.PI) / 2);
}

export function joyTailPoint(t, pose, art) {
  return cubicPoint(art.tail.points, t).map(
    (value, axis) => value + Math.sin((t * Math.PI) / 2) ** 2 * pose.tail * art.tail.sway[axis],
  );
}
