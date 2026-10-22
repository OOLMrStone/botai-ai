import { sitPose } from './lemur-sit-motion.mjs';
import {
  number,
  pair,
  path,
  group,
  ellipse,
  lemurHeadLayers,
  lemurGradients,
  lemurEyeAperture,
} from './lemur-svg.mjs';

function eyeSvg(eye, blink, head, color) {
  const [x, y, width, height] = eye.bounds;
  const left = x - head.eyeMargin;
  const right = x + width + head.eyeMargin;
  const middle = x + width / 2;
  const aperture = lemurEyeAperture({ x, y, width, height }, eye, blink, head.eyeMargin, eye.iris);
  const [hx, hy, radius] = eye.highlight;
  const shapes =
    path(eye.iris, 'url(#iris)') +
    path(eye.pupil, color.pupil) +
    ellipse([hx, hy], [radius, radius], color.white);
  const crease = path(
    `M ${left} ${eye.closedY} Q ${middle} ${eye.closedY - eye.curveLift * 2} ${right} ${eye.closedY}`,
    'none',
    `stroke="${color.pupil}" stroke-width="${head.lidWidth}" stroke-linecap="round" opacity="${number(blink)}"`,
  );

  return `<defs><clipPath id="${eye.name}-iris">${path(eye.iris, color.white)}</clipPath><clipPath id="${eye.name}-lid">${path(aperture, color.white)}</clipPath></defs><g clip-path="url(#${eye.name}-iris)">${crease}<g clip-path="url(#${eye.name}-lid)">${shapes}</g></g>`;
}

function headSvg(pose, art, color) {
  const head = art.head;
  const shapes =
    lemurHeadLayers(head, color) +
    head.eyes.map((eye) => eyeSvg(eye, pose.blink, head, color)).join('') +
    path(head.muzzle, color.muzzle) +
    path(head.nose, color.pupil) +
    path(
      head.mouth,
      'none',
      `stroke="${color.pupil}" stroke-width="${head.mouthWidth}" stroke-linecap="round"`,
    );

  return group(`translate(0 ${number(pose.headY)})`, shapes);
}

export function lemurSitSvg(time, art, motion, base) {
  const pose = sitPose(time, motion);
  const color = base.colors;
  const shadow = art.shadow;
  const ground = `<rect x="${shadow.x}" y="${shadow.y}" width="${shadow.width}" height="${shadow.height}" rx="${shadow.radius}" fill="${color.paw}" opacity="${shadow.opacity}"/>`;
  const tail =
    path(art.tail.path, color.tail) +
    `<g clip-path="url(#sit-tail)">${art.tail.bands.map((band) => path(band, 'url(#cream)')).join('')}</g>`;
  const seams = art.seams
    .map((seam) =>
      path(
        seam,
        'none',
        `stroke="${color.paw}" stroke-width="${art.seamWidth}" opacity="${art.seamOpacity}" stroke-linecap="round"`,
      ),
    )
    .join('');
  const body = group(
    `translate(${pair(art.bodyPivot)}) scale(1 ${pose.bodyScaleY}) translate(${pair(art.bodyPivot.map((value) => -value))})`,
    path(art.body, color.body) + path(art.belly, 'url(#cream)') + seams,
  );
  const feet = art.feet.map((foot) => path(foot, color.paw)).join('');
  const [x, y, width, height] = art.viewBox;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.size}" height="${art.size}" viewBox="${art.viewBox.join(' ')}"><defs>${lemurGradients(color)}<clipPath id="sit-tail">${path(art.tail.path, color.white)}</clipPath></defs><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color.white}"/>${ground}${tail}${body}${feet}${headSvg(pose, art, color)}</svg>`;
}
