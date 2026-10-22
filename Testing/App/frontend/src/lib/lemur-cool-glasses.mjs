import { ellipse, group, number, pair, path } from './lemur-svg.mjs';

function scoreSvg(lens, pose, glasses) {
  const turnWidth = Math.max(glasses.minimumTurnWidth, Math.abs(Math.cos(pose.scoreAngle)));
  const depth = Math.sin(pose.scoreAngle) * glasses.scoreDepth;
  const digits = glasses.digitOffsets
    .map((x, index) =>
      group(`translate(${x} 0)`, path(index ? glasses.digitZero : glasses.digitOne, 'none')),
    )
    .join('');
  const glyph = (stroke) =>
    `<g stroke="${stroke}" stroke-width="${glasses.digitWidth}" stroke-linecap="round" stroke-linejoin="round">${digits}</g>`;
  const content =
    group(`translate(${number(depth)} 0)`, glyph(glasses.scoreDepthColor)) +
    glyph('url(#cool-score)');

  return group(
    `translate(${pair(lens.center)}) rotate(${number(Math.sin(pose.scoreAngle) * glasses.scoreTilt)}) scale(${number(turnWidth * glasses.scoreScale)} ${glasses.scoreScale}) translate(${-glasses.scoreCenter[0]} ${-glasses.scoreCenter[1]})`,
    content,
  );
}

function eyeSvg(lens, pose, art, colors) {
  const eye = art.head.eyes[lens.eyeIndex];
  const [x, y, rx, ry] = eye.pupil;
  const [hx, hy, radius] = eye.highlight;
  const eyeScale = 1 - pose.scoreMix * art.glasses.eyeRevealScale;
  const drawing =
    path(eye.iris, 'url(#iris)') +
    ellipse([x, y], [rx, ry], colors.pupil) +
    ellipse([hx, hy], [radius, radius], colors.white);

  return `<g opacity="${number(1 - pose.scoreMix)}">${group(`translate(${pair(lens.center)}) scale(${number(eyeScale)}) translate(${-lens.center[0]} ${-lens.center[1]})`, drawing)}</g>`;
}

export function coolGlassesDefs(pose, glasses, colors) {
  const shift = Math.sin(pose.shimmerAngle) * glasses.scoreGradientSpan;
  const stops = glasses.scoreColors
    .map(
      (color, index) =>
        `<stop offset="${index / (glasses.scoreColors.length - 1)}" stop-color="${color}"/>`,
    )
    .join('');

  return `<linearGradient id="cool-lens" x2="${glasses.lensGradientEnd[0]}" y2="${glasses.lensGradientEnd[1]}"><stop stop-color="${glasses.lensTop}"/><stop offset="1" stop-color="${glasses.lensBottom}"/></linearGradient><linearGradient id="cool-score" gradientUnits="userSpaceOnUse" x1="${number(shift)}" x2="${number(shift + glasses.scoreGradientSpan)}" y1="${glasses.scoreGradientY[0]}" y2="${glasses.scoreGradientY[1]}" spreadMethod="reflect">${stops}</linearGradient><clipPath id="cool-lenses">${glasses.lenses.map((lens) => path(lens.path, colors.white)).join('')}</clipPath>`;
}

export function coolGlassesSvg(pose, art, baseArt) {
  const glasses = art.glasses;
  const colors = baseArt.colors;
  const eyeArt = { head: baseArt.head, glasses };
  const eyes = glasses.lenses.map((lens) => eyeSvg(lens, pose, eyeArt, colors)).join('');
  const scores = `<g opacity="${number(pose.scoreMix)}" clip-path="url(#cool-lenses)">${glasses.lenses.map((lens) => scoreSvg(lens, pose, glasses)).join('')}</g>`;
  const bridge = path(
    glasses.bridge,
    'none',
    `stroke="${glasses.frame}" stroke-width="${glasses.bridgeWidth}" stroke-linecap="round"`,
  );
  const lenses = glasses.lenses
    .map(
      (lens) =>
        path(
          lens.path,
          'url(#cool-lens)',
          `fill-opacity="${glasses.lensOpacity}" stroke="${glasses.rim}" stroke-width="${glasses.rimWidth}"`,
        ) +
        path(
          lens.reflection,
          'none',
          `stroke="${colors.white}" stroke-width="${glasses.reflectionWidth}" stroke-linecap="round" opacity="${glasses.reflectionOpacity}"`,
        ),
    )
    .join('');
  const shineX =
    glasses.shineRange[0] + pose.shine * (glasses.shineRange[1] - glasses.shineRange[0]);
  const shine = `<g clip-path="url(#cool-lenses)" opacity="${number(pose.shineVisible * glasses.shineOpacity)}">${group(`translate(${number(shineX)} 0)`, path(glasses.shinePath, colors.white))}</g>`;
  const star = group(
    `translate(${pair(glasses.starCenter)}) rotate(${number(pose.starTurn)}) scale(${number(pose.star * glasses.starRadius)})`,
    path(glasses.starPath, colors.white),
  );

  return eyes + scores + bridge + lenses + shine + star;
}
