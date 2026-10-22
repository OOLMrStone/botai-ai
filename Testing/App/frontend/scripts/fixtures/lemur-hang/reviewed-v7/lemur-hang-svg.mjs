import { ribbon } from './lemur-ribbon.mjs';
import { animationChannel } from './animation-channel.mjs';
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
import { quadraticPoint } from './lemur-joy-motion.mjs';
import { frontalMouthSvg } from './lemur-joy-svg.mjs';

const mixPoint = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

const curlAt = (time, motion) =>
  animationChannel(
    ((time % motion.bodyPeriod) + motion.bodyPeriod) % motion.bodyPeriod,
    motion.curl,
  );

export function hangPose(time, motion) {
  const bodyTime = (time + (motion.bodyOffset ?? 0)) % motion.duration;
  const phase = (bodyTime / motion.duration) * Math.PI * 2;
  const gesture = motion.mode === 'heart' ? animationChannel(time, motion.gesture) : 0;

  return {
    swing: Math.sin(phase) * motion.swingDegrees,
    head: -Math.sin(phase) * motion.headFollow + gesture * motion.headNod,
    blink: animationChannel(bodyTime, motion.blink),
    gesture,
    heart: motion.mode === 'heart' ? animationChannel(time, motion.heart) : 0,
    curl: curlAt(bodyTime, motion),
    headCurl: curlAt(bodyTime - motion.headLag, motion),
  };
}

function limbSvg(limb, colors, motion, art, pawOnly = false) {
  const sample = (t) => quadraticPoint([limb.root, limb.bend, limb.end], t);
  const radius = (t) =>
    (pawOnly ? art.pawMaskScale : 1) *
    quadraticPoint(
      limb.radii.map((r) => [r]),
      t,
    )[0];

  return (
    (pawOnly
      ? ''
      : path(ribbon(sample, radius, 0, 1, motion.samples, true), colors.body) +
        ellipse(limb.root, [limb.radii[0], limb.radii[0]], colors.body)) +
    (limb.hand
      ? ''
      : path(
          ribbon(
            sample,
            radius,
            limb.pawStart ?? art.pawStart,
            1,
            motion.samples,
            true,
            limb.pawBoundaryCurve ?? art.pawBoundaryCurve,
          ),
          colors.paw,
        ))
  );
}

function tailSvg(art, colors, motion, pose) {
  const tail = art.tail;
  const sample = (t) => {
    const y = tail.points[0][1] + (tail.points[1][1] - tail.points[0][1]) * t;
    const u = Math.min(
      1,
      Math.max(0, (y - tail.bendRange[0]) / (tail.bendRange[1] - tail.bendRange[0])),
    );
    const bend = u * u * u * (10 + u * (-15 + 6 * u));
    const x = tail.points[0][0] + (tail.points[1][0] - tail.points[0][0]) * bend;
    const angle = (pose.swing * bend * Math.PI) / 180;
    const dx = x - motion.anchor[0],
      dy = y - motion.anchor[1];

    return [
      motion.anchor[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
      motion.anchor[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
    ];
  };
  const radius = (t) =>
    quadraticPoint(
      tail.radii.map((r) => [r]),
      t,
    )[0];
  const contour = ribbon(sample, radius, 0, 1, tail.samples);
  const bands = tail.bands
    .slice(0, -1)
    .map((start, index) =>
      path(
        ribbon(
          sample,
          radius,
          Math.max(0, start - motion.bandOverlap),
          Math.min(1, tail.bands[index + 1] + motion.bandOverlap),
          tail.samples,
        ),
        colors[tail.bandColors[index]],
      ),
    )
    .join('');

  const hookBands = tail.hookBands.map((band) => path(band, colors.tail)).join('');

  return `<defs><clipPath id="tail-hook-contour">${path(tail.hook, colors.white)}</clipPath><clipPath id="tail-contour">${path(contour, colors.white)}</clipPath></defs><g clip-path="url(#tail-hook-contour)">${path(tail.hook, colors.cream)}${hookBands}</g><g clip-path="url(#tail-contour)">${path(contour, colors[tail.bandColors[0]])}${bands}</g>`;
}

function headSvg(pose, art, base) {
  const head = base.head;
  const colors = base.colors;
  const eyes = head.eyes
    .map((eye) => {
      const [x, y, rx, ry] = eye.pupil;
      const [hx, hy, hr] = eye.highlight;
      const drawing =
        path(eye.iris, 'url(#iris)') +
        ellipse([x, y], [rx, ry], colors.pupil) +
        ellipse([hx, hy], [hr, hr], colors.white);

      return group(
        `translate(0 ${eye.center[1]}) scale(1 ${number(1 - pose.blink)}) translate(0 ${-eye.center[1]})`,
        drawing,
      );
    })
    .join('');
  const mouth = frontalMouthSvg(head, colors, pose.gesture);

  return group(
    `translate(${pair(art.head.center.map((value, index) => value + art.head.curlOffset[index] * pose.headCurl))}) rotate(${number(art.head.tilt + pose.head + pose.headCurl * art.head.curlTilt)}) scale(${art.head.scale}) translate(${-art.head.origin[0]} ${-art.head.origin[1]})`,
    lemurHeadLayers(head, colors) + eyes + mouth,
  );
}

export function lemurHangSvg(time, art, motion, base) {
  const pose = hangPose(time, motion);
  const colors = base.colors;
  const bodyTime = time + (motion.bodyOffset ?? 0);
  const legs = art.legs.map((leg) => ({
    ...leg,
    bend: mixPoint(leg.bend, leg.curlBend, pose.curl),
    end: mixPoint(leg.end, leg.curlEnd, pose.curl),
  }));
  const arms = art.arms.map((arm) => ({
    ...arm,
    hand: true,
    root: mixPoint(arm.root, arm.curlRoot, pose.curl),
    bend: mixPoint(
      mixPoint(arm.bend, arm.curlBend, curlAt(bodyTime - arm.delay, motion)),
      arm.heartBend,
      pose.gesture,
    ),
    end: mixPoint(
      mixPoint(arm.end, arm.curlEnd, curlAt(bodyTime - arm.delay, motion)),
      arm.heartEnd,
      pose.gesture,
    ),
  }));
  const heart = group(
    `translate(${pair(art.heart.center)}) scale(${number(pose.heart)})`,
    path(art.heart.path, art.heart.color),
  );
  const handPath = morphPath(art.heart.restPawPath, art.heart.pawPath, pose.gesture);
  const hands = arms
    .map((arm, index) =>
      group(`translate(${pair(arm.end)}) scale(${index ? -1 : 1} 1)`, path(handPath, colors.paw)),
    )
    .join('');
  const character =
    group(
      `rotate(${number(-pose.swing)} ${pair(motion.anchor)})`,
      tailSvg(art, colors, motion, pose),
    ) +
    limbSvg(legs[0], colors, motion, art) +
    limbSvg(arms[0], colors, motion, art) +
    path(morphPath(art.body.path, art.body.curledPath, pose.curl), colors.body) +
    path(morphPath(art.body.belly, art.body.curledBelly, pose.curl), 'url(#cream)') +
    `<defs><clipPath id="body-contour">${path(morphPath(art.body.path, art.body.curledPath, pose.curl), colors.white)}</clipPath></defs><g clip-path="url(#body-contour)">${limbSvg(legs[1], colors, motion, art, true)}</g>` +
    limbSvg(arms[1], colors, motion, art) +
    headSvg(pose, art, base) +
    heart +
    hands;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.size}" height="${art.size}" viewBox="${art.viewBox.join(' ')}"><defs>${lemurGradients(colors)}</defs>${group(`rotate(${number(pose.swing)} ${pair(motion.anchor)})`, character)}</svg>`;
}
