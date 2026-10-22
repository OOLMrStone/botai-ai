import { animationChannel } from './animation-channel.mjs';
import { quadraticPoint } from './lemur-joy-motion.mjs';

const mix = (a, b, t) => a + (b - a) * t;

function armCurve(root, bend, end, progress, settings) {
  const chord = Math.hypot(end[0] - root[0], end[1] - root[1]);
  const unit = end.map((value, index) => (value - root[index]) / chord);
  const normal = [-unit[1], unit[0]];
  const middle = root.map((value, index) => (value + end[index]) / 2);
  let low = 0;
  let high = 2 * Math.PI;

  // Длину задаёт нарисованная ось, а не отрезки до управляющей точки.
  for (let index = 0; index < settings.curveIterations; index++) {
    const turn = (low + high) / 2;
    if ((2 * Math.sin(turn / 2)) / turn > chord / settings.axisLength) low = turn;
    else high = turn;
  }

  const turn = (low + high) / 2;
  const radius = settings.axisLength / turn;
  return (at) => {
    const angle = (at - 0.5) * turn;
    const original = quadraticPoint([root, bend, end], at);
    return middle.map((value, index) => {
      const curved =
        value +
        radius * Math.sin(angle) * unit[index] -
        radius * (Math.cos(angle) - Math.cos(turn / 2)) * normal[index];
      return mix(original[index], curved, progress);
    });
  };
}

function arcMix(from, to, root, progress) {
  const start = from.map((value, index) => value - root[index]);
  const end = to.map((value, index) => value - root[index]);
  const startAngle = Math.atan2(start[1], start[0]);
  const delta = Math.atan2(end[1], end[0]) - startAngle;
  const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
  const angle = startAngle + turn * progress;
  const radius = mix(Math.hypot(...start), Math.hypot(...end), progress);

  return [root[0] + radius * Math.cos(angle), root[1] + radius * Math.sin(angle)];
}

function rotatePoint(point, root, angle) {
  const radians = (angle * Math.PI) / 180;
  const [x, y] = point.map((value, index) => value - root[index]);

  return [
    root[0] + x * Math.cos(radians) - y * Math.sin(radians),
    root[1] + x * Math.sin(radians) + y * Math.cos(radians),
  ];
}

function waveChannel(time, keys) {
  const index = keys.findIndex(([at]) => at > time);
  if (index < 0) return keys.at(-1)[1];
  if (index === 0) return keys[0][1];

  const [start, from] = keys[index - 1];
  const [end, to] = keys[index];
  const phase = (time - start) / (end - start);
  if (from === to) return from;

  // У разворотов сохраняем ускорение, у входа и выхода согласуем его с покоем.
  const startAcceleration = keys[index - 2]?.[1] === from ? 0 : Math.PI ** 2 / 2;
  const endAcceleration = keys[index + 1]?.[1] === to ? 0 : -(Math.PI ** 2 / 2);
  const a2 = startAcceleration / 2;
  const a3 = 10 - 1.5 * startAcceleration + endAcceleration / 2;
  const a4 = -15 + 1.5 * startAcceleration - endAcceleration;
  const a5 = 6 - startAcceleration / 2 + endAcceleration / 2;
  const eased = phase ** 2 * (a2 + phase * (a3 + phase * (a4 + phase * a5)));

  return mix(from, to, eased);
}

export function wavePose(time, motion) {
  const pose = Object.fromEntries(
    Object.entries(motion.channels).map(([name, keys]) => [name, animationChannel(time, keys)]),
  );

  return {
    ...pose,
    wave: waveChannel(time, motion.channels.wave),
    idle: 0,
    legs: 0,
    crouch: 0,
    lift: 0,
  };
}

export function waveArm(limb, pose, motion) {
  const rest = motion.armRest[limb.name];
  if (limb.name !== 'screen-left') {
    return {
      foregroundStart: limb.rootCover,
      root: rest.root,
      bend: rest.bend,
      surfaceEnd: limb.end,
      end: limb.end,
      radii: limb.radii,
      paw: limb.paw,
      angle: limb.paw[2],
    };
  }

  const angle = motion.raisedArm.waveAngle * ((pose.wave + 1) / 2) * pose.arm;
  const bend = arcMix(rest.bend, motion.raisedArm.bend, rest.root, pose.arm);
  const end = rotatePoint(arcMix(limb.end, motion.raisedArm.end, rest.root, pose.arm), bend, angle);

  return {
    foregroundStart: limb.rootCover,
    root: rest.root,
    bend,
    surfaceEnd: end,
    end,
    radii: motion.raisedArm.radii,
    paw: limb.paw,
    angle: mix(limb.paw[2], motion.raisedArm.pawAngle, pose.arm) + angle,
    pointAt: armCurve(rest.root, bend, end, pose.arm, motion.raisedArm),
  };
}
