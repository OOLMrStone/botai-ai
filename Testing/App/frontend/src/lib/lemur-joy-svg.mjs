import { ribbon } from './lemur-ribbon.mjs';
import {
  number,
  pair,
  path,
  group,
  ellipse,
  lemurHeadLayers,
  lemurGradients,
  morphPath,
} from './lemur-svg.mjs';
import { animationChannel } from './animation-channel.mjs';
import {
  joyPose,
  joyLimb,
  joyTailPoint,
  joyTailRadius,
  quadraticPoint,
  joyBodyPath,
} from './lemur-joy-motion.mjs';

export function frontalLimbSvg(
  limb,
  colors,
  samples,
  start = 0,
  taperUntil = 0,
  taperStrength = 1,
) {
  const sample =
    limb.pointAt ?? ((t) => quadraticPoint([limb.root, limb.bend, limb.surfaceEnd], t));
  const radius = (t) => {
    const blend = taperUntil ? Math.min(1, t / taperUntil) : 1;
    return (
      (1 - taperStrength + taperStrength * blend * blend * (3 - 2 * blend)) *
      quadraticPoint(
        limb.radii.map((r) => [r]),
        t,
      )[0]
    );
  };

  return (
    path(ribbon(sample, radius, start, 1, samples), colors.body) +
    ellipse(sample(start), [radius(start), radius(start)], colors.body) +
    ellipse(limb.surfaceEnd, [limb.radii[2], limb.radii[2]], colors.body)
  );
}

export function frontalPawSvg(limb, fill) {
  if (limb.pawPath) {
    return group(
      `translate(${pair(limb.end)}) rotate(${number(limb.angle)})`,
      path(limb.pawPath, fill, 'data-part="foot"'),
    );
  }
  return group(
    `rotate(${number(limb.angle)} ${pair(limb.end)})`,
    ellipse(limb.end, limb.paw, fill),
  );
}

export function frontalTailSvg(pose, art) {
  const sample = (t) => joyTailPoint(t, pose, art);
  const radius = (t) => joyTailRadius(t, art);
  const bands = art.tail.bands
    .slice(0, -1)
    .map((start, i) => {
      const fill = i % 2 ? art.colors.cream : art.colors.tail;
      return path(
        ribbon(sample, radius, start, art.tail.bands[i + 1], art.tail.samples),
        fill,
        `stroke="${fill}" stroke-width="0.5" stroke-linejoin="round"`,
      );
    })
    .join('');

  return path(ribbon(sample, radius, 0, 1, art.tail.samples, true), art.colors.tail) + bands;
}

function starSvg(center, radius, fill, angle = 0) {
  const r = radius;
  const inset = r / 4;
  const d = `M 0 ${-r} Q ${inset} ${-inset} ${r} 0 Q ${inset} ${inset} 0 ${r} Q ${-inset} ${inset} ${-r} 0 Q ${-inset} ${-inset} 0 ${-r} Z`;
  return group(`translate(${pair(center)}) rotate(${number(angle)})`, path(d, fill));
}

function eyeSvg(eye, index, pose, time, art, motion) {
  const colors = art.colors;
  const sparkle =
    animationChannel(time - index * art.arms[1].delay, motion.channels.sparkle) +
    pose.idle * motion.idle.sparkle;
  const open = Math.max(0.05, 1 - pose.blink);
  const [x, y, rx, ry] = eye.pupil;
  const [hx, hy, hr] = eye.highlight;
  const [sx, sy, sr] = eye.star;
  const content =
    path(eye.iris, 'url(#iris)') +
    ellipse([x, y], [rx, ry], colors.pupil) +
    ellipse([hx, hy], [hr * (1 - sparkle * 0.7), hr * (1 - sparkle * 0.7)], colors.white) +
    starSvg([sx, sy], sr * sparkle, colors.white, sparkle * motion.eyeStarTurn) +
    starSvg([x + rx / 2, y + ry / 2], (sr * sparkle) / 3, colors.white);

  return `<g opacity="${number(Math.min(1, open * 3))}">${group(`translate(0 ${eye.center[1]}) scale(1 ${number(open)}) translate(0 ${-eye.center[1]})`, content)}</g>`;
}

export function frontalMouthSvg(head, colors, open = 1) {
  return (
    path(morphPath(head.closedMuzzle, head.muzzle, open), colors.muzzle) +
    path(morphPath(head.closedMouth, head.mouth, open), colors.pupil) +
    path(
      morphPath(head.closedTongue, head.tongue, open),
      colors.tongue,
      `opacity="${number(open)}"`,
    ) +
    path(head.nose, colors.pupil)
  );
}

export function frontalHeadSvg(pose, time, art, motion) {
  const colors = art.colors;
  const layers = lemurHeadLayers(art.head, colors);
  const eyes = art.head.eyes
    .map((eye, index) => eyeSvg(eye, index, pose, time, art, motion))
    .join('');
  const mouth = frontalMouthSvg(art.head, colors, pose.mouthOpen ?? 1);

  return group(
    `translate(0 ${number(pose.headLag - pose.legs * motion.headRise)}) rotate(${number(pose.headTilt)} ${pair(art.head.pivot)})`,
    layers + eyes + mouth,
  );
}

export function lemurJoySvg(time, art, motion) {
  const pose = joyPose(time, motion);
  const legs = art.legs.map((limb) => joyLimb(limb, 'leg', time, pose, motion));
  const arms = art.arms.map((limb) => joyLimb(limb, 'arm', time, pose, motion));
  const color = art.colors;
  const body =
    path(joyBodyPath(art.body.path, art.body.raisedPath, pose, art, motion), color.body) +
    path(
      joyBodyPath(art.body.belly, art.body.raisedBelly, pose, art, motion),
      'url(#cream)',
      'data-part="belly"',
    );
  const character =
    frontalTailSvg(pose, art) +
    arms.map((arm) => frontalLimbSvg(arm, color, motion.samples)).join('') +
    body +
    legs.map((leg) => frontalPawSvg(leg, color.paw)).join('') +
    arms
      .map((arm) =>
        frontalLimbSvg(
          arm,
          color,
          motion.samples,
          arm.foregroundStart,
          art.foregroundTaper,
          arm.foregroundTaperStrength,
        ),
      )
      .join('') +
    frontalHeadSvg(pose, time, art, motion) +
    arms.map((arm) => frontalPawSvg(arm, color.paw)).join('');
  const shadow = ellipse(
    [art.shadow.cx, art.shadow.cy],
    [art.shadow.rx * (1 - pose.lift / motion.flight.height / 4), art.shadow.ry],
    color.shadow,
    `opacity="${number(1 - pose.lift / motion.flight.height / 2)}"`,
  );
  const defs = `<defs>${lemurGradients(color)}</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.size}" height="${art.size}" viewBox="${art.viewBox.join(' ')}">${defs}<path fill="${color.white}" d="M0 0H${art.viewBox[2]}V${art.viewBox[3]}H0Z"/>${group(`translate(${pair(art.offset)})`, shadow + group(`translate(0 ${number(pose.y)})`, character))}</svg>`;
}
