import { ellipse, group, lemurGradients, pair, path } from './lemur-svg.mjs';
import { joyLimb } from './lemur-joy-motion.mjs';
import { frontalHeadSvg, frontalLimbSvg, frontalPawSvg } from './lemur-joy-svg.mjs';
import { waveArm, wavePose } from './lemur-wave-motion.mjs';
import { waveTailSvg } from './lemur-wave-tail.mjs';

function waveHeadArt(art, motion) {
  const layers = [...art.head.layers];
  layers.splice(3, 0, ...motion.head.earBridges.map((bridge) => ({ fill: 'cream', path: bridge })));

  return { ...art, head: { ...art.head, layers } };
}

export function lemurWaveSvg(time, art, motion) {
  const pose = wavePose(time, motion);
  const legs = art.legs.map((limb) => joyLimb(limb, 'leg', time, pose, motion));
  const arms = art.arms.map((limb) => waveArm(limb, pose, motion));
  const wavingArm = arms.find((arm, index) => art.arms[index].name === 'screen-left');
  const restingArms = arms.filter((arm, index) => art.arms[index].name !== 'screen-left');
  const headArt = waveHeadArt(art, motion);
  const color = art.colors;
  const body = path(art.body.path, color.body) + path(art.body.belly, 'url(#cream)');
  const bodyTransform = `matrix(1 0 ${pose.lean} 1 ${-pose.lean * art.floor} 0)`;
  // Наклон тела переносит плечо, но не растягивает вращающуюся лапу.
  const armTransform = `translate(${pose.lean * (wavingArm.root[1] - art.floor)} 0)`;
  const upperBody =
    group(
      bodyTransform,
      body + restingArms.map((arm) => frontalLimbSvg(arm, color, motion.samples)).join(''),
    ) +
    group(
      armTransform,
      `<g data-part="waving-arm">${frontalLimbSvg(wavingArm, color, motion.samples)}</g>`,
    ) +
    group(
      bodyTransform,
      `<g data-part="head">${frontalHeadSvg(pose, time, headArt, motion)}</g>` +
        frontalPawSvg(restingArms[0], color.paw),
    ) +
    group(armTransform, frontalPawSvg(wavingArm, color.paw));
  const character =
    waveTailSvg(time, art, motion) +
    upperBody +
    legs.map((leg) => frontalPawSvg(leg, color.paw)).join('');
  const shadow = ellipse(
    [art.shadow.cx, art.shadow.cy],
    [art.shadow.rx, art.shadow.ry],
    color.shadow,
  );
  const defs = `<defs>${lemurGradients(color)}</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.size}" height="${art.size}" viewBox="${art.viewBox.join(' ')}">${defs}<path fill="${color.white}" d="M0 0H${art.viewBox[2]}V${art.viewBox[3]}H0Z"/>${group(`translate(${pair(art.offset)})`, shadow + character)}</svg>`;
}
