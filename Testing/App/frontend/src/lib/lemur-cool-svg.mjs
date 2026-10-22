import { coolGlassesDefs, coolGlassesSvg } from './lemur-cool-glasses.mjs';
import { animationChannel } from './animation-channel.mjs';
import {
  ellipse,
  group,
  lemurGradients,
  lemurHeadLayers,
  number,
  pair,
  path,
} from './lemur-svg.mjs';
import { frontalMouthSvg, frontalPawSvg, frontalTailSvg } from './lemur-joy-svg.mjs';

export function coolPose(time, motion) {
  const localTime = ((time % motion.duration) + motion.duration) % motion.duration;

  const channels = Object.fromEntries(
    Object.entries(motion.channels).map(([name, keys]) => [
      name,
      animationChannel(localTime, keys),
    ]),
  );
  const score = motion.score;
  const progress = Math.max(0, Math.min(1, (localTime - score.start) / (score.end - score.start)));
  const scoreMix = animationChannel(localTime, [
    [score.start - score.transition / 2, 0],
    [score.start + score.transition / 2, 1],
    [score.end - score.transition / 2, 1],
    [score.end + score.transition / 2, 0],
  ]);

  return {
    ...channels,
    scoreMix,
    scoreAngle: progress * Math.PI * 2 * score.turns,
    shimmerAngle: progress * Math.PI * 2 * score.shimmerTurns,
  };
}

export function lemurCoolSvg(time, art, motion, baseArt) {
  const pose = coolPose(time, motion);
  const colors = { ...baseArt.colors, armShade: art.armShade };
  const bodyPivot = art.body.breathPivot;
  const bodyScale = motion.breathScale.map((amount) => 1 + amount * pose.breath);
  const body = group(
    `translate(${pair(bodyPivot)}) scale(${pair(bodyScale)}) translate(${-bodyPivot[0]} ${-bodyPivot[1]})`,
    path(art.body.path, colors.body) + path(art.body.belly, 'url(#cream)'),
  );
  const arms = group(
    `translate(0 ${number(-pose.breath * motion.armRise)})`,
    art.arms
      .map((arm) => path(arm.path, colors[arm.fillKey ?? 'body']) + path(arm.paw, colors.paw))
      .join(''),
  );
  const headArt = { ...baseArt.head, layers: [...baseArt.head.layers] };
  headArt.layers.splice(3, 0, ...art.head.earBridges.map((d) => ({ fill: 'cream', path: d })));
  const head = group(
    `translate(0 ${number(-pose.confidence * motion.chinRise)}) rotate(${number(art.head.tilt + pose.confidence * motion.headTilt)} ${pair(baseArt.head.pivot)})`,
    lemurHeadLayers(headArt, colors) +
      frontalMouthSvg(baseArt.head, colors, motion.mouthOpen) +
      coolGlassesSvg({ ...pose, starTurn: pose.star * motion.starTurn }, art, baseArt),
  );
  const feet = baseArt.legs.map((leg) => frontalPawSvg({ ...leg, angle: 0 }, colors.paw)).join('');
  const shadow = ellipse(
    [baseArt.shadow.cx, baseArt.shadow.cy],
    [baseArt.shadow.rx, baseArt.shadow.ry],
    colors.shadow,
  );
  const character = frontalTailSvg(pose, baseArt) + body + arms + head + feet;
  const defs = `<defs>${lemurGradients(colors)}${coolGlassesDefs(pose, art.glasses, colors)}</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${baseArt.size}" height="${baseArt.size}" viewBox="${baseArt.viewBox.join(' ')}">${defs}${group(`translate(${pair(art.offset)})`, shadow + character)}</svg>`;
}
