import { cryPose, cryWater, cryHighlight } from './lemur-cry-motion.mjs';
import {
  number,
  pair,
  path,
  group,
  ellipse,
  lemurHeadLayers,
  lemurGradients,
} from './lemur-svg.mjs';

function eyeWater(index, time, art, motion) {
  const tear = art.head.tear;
  const flow = cryWater(time, index, motion);
  const shape = `M ${pair([tear.start[0], tear.start[1] + flow.tilt])} Q ${tear.bend[0]} ${number(tear.bend[1] + flow.surface)} ${pair([tear.end[0], tear.end[1] - flow.tilt])}`;
  const surface = `stroke-width="${tear.width}" stroke-linecap="round"`;
  const water = path(
    shape,
    'none',
    `stroke="${art.colors.tear}" stroke-opacity="${tear.opacity}" ${surface}`,
  );
  const reflection = group(
    `translate(${number(flow.reflectionX)} ${number(flow.reflectionY)})`,
    path(
      tear.reflectionPath,
      'none',
      `stroke="${art.colors.tearLight}" stroke-width="${tear.highlightWidth}" stroke-linecap="round" opacity="${number(tear.reflectionOpacity + flow.shimmer)}"`,
    ),
  );

  return `<defs><mask id="water-${index}">${path(shape, 'none', `stroke="white" ${surface}`)}</mask></defs>${water}<g mask="url(#water-${index})">${reflection}</g>`;
}

function eyeSvg(position, index, pose, time, art, base, motion) {
  const eye = art.head.eye;
  const [x, y, rx, ry] = eye.pupil;
  const color = base.colors;
  const iris = path(eye.iris, 'url(#iris)');
  const pupil = ellipse([x, y], [rx, ry], color.pupil);
  const shine = art.head.highlights
    .map(([dx, dy, radiusX, radiusY, angle], highlight) => {
      const light = cryHighlight(time, index, highlight, motion);
      const center = [x + dx + light.x, y + dy + light.y];

      return group(
        `rotate(${angle} ${pair(center)})`,
        ellipse(center, [radiusX * light.scale, radiusY * light.scale], color.white),
      );
    })
    .join('');
  const eyes = `<g clip-path="url(#cry-eye)">${iris}${pupil}<g clip-path="url(#cry-pupil)">${shine}</g></g>`;
  const lid = eye.lid;
  const top = lid.top + (eye.blinkAnchor - lid.top) * pose.blink;
  const bottom = lid.bottom + (eye.blinkAnchor - lid.bottom) * pose.blink;
  const curve = lid.curve * (1 - pose.blink);
  const opening = `M ${-lid.halfWidth} ${number(top + curve)} Q 0 ${number(top - curve)} ${lid.halfWidth} ${number(top + curve)} L ${lid.halfWidth} ${number(bottom - curve)} Q 0 ${number(bottom + curve)} ${-lid.halfWidth} ${number(bottom - curve)} Z`;
  const open = `<defs><clipPath id="blink-${index}">${path(opening, color.white)}</clipPath></defs><g clip-path="url(#blink-${index})" opacity="${number(Math.min(1, pose.eyeOpen * motion.face.blinkFade))}">${group(`scale(1 ${number(1 + pose.appeal * motion.face.eyeStretch)})`, eyes)}</g>`;
  const closure = Math.max(0, (pose.blink - eye.closedFrom) / (1 - eye.closedFrom));
  const closed = path(
    eye.closedPath,
    'none',
    `stroke="${color.pupil}" stroke-width="${eye.closedWidth}" stroke-linecap="round" opacity="${number(closure * closure * (3 - 2 * closure))}"`,
  );
  const mask = group(
    `translate(0 ${eye.blinkAnchor}) scale(1 ${number(1 - pose.blink * eye.maskCompression)}) translate(0 ${-eye.blinkAnchor})`,
    path(eye.mask, color.mask),
  );
  const water = eyeWater(index, time, art, motion);

  return group(`translate(${pair(position)})`, mask + open + closed + water);
}

function mouthSvg(pose, art, color) {
  const mouth = art.head.mouth;
  const width = mouth.halfWidth - pose.mouthOpen * mouth.widthContraction;
  const depth = mouth.closedDepth + pose.mouthOpen * mouth.openDepth;
  const bottom = -mouth.arch + depth;
  const shape = `M ${-width} 0 C ${-width} ${-mouth.arch / 2} ${-width / 2} ${-mouth.arch} 0 ${-mouth.arch} C ${width / 2} ${-mouth.arch} ${width} ${-mouth.arch / 2} ${width} 0 C ${width} ${number(bottom / 2)} ${width / 2} ${number(bottom)} 0 ${number(bottom)} C ${-width / 2} ${number(bottom)} ${-width} ${number(bottom / 2)} ${-width} 0 Z`;
  const lip = path(
    mouth.lipPath,
    'none',
    `stroke="${art.colors.lip}" stroke-width="${mouth.lipWidth}" stroke-linecap="round" opacity="${number(pose.mouthOpen * mouth.lipOpacity)}"`,
  );

  return group(
    `translate(${number(mouth.center[0] + pose.mouthX)} ${number(mouth.center[1] + pose.mouthY)})`,
    path(shape, color.pupil) + lip,
  );
}

function headSvg(pose, time, art, base, motion) {
  const color = base.colors;
  const content =
    lemurHeadLayers(art.head, color) +
    art.head.eyes
      .map((position, index) => eyeSvg(position, index, pose, time, art, base, motion))
      .join('') +
    group(
      `translate(0 ${number(pose.muzzleY)})`,
      path(art.head.muzzle, color.muzzle) +
        mouthSvg(pose, art, color) +
        path(art.head.nose, color.pupil),
    );

  return group(
    `translate(${pair(art.head.offset)}) scale(${art.head.scale})`,
    group(
      `translate(0 ${number(pose.headY)}) rotate(${number(pose.headTilt)} ${pair(art.head.pivot)})`,
      content,
    ),
  );
}

export function lemurCrySvg(time, art, motion, base) {
  const pose = cryPose(time, motion);
  const color = base.colors;
  const tail =
    path(art.tail.path, 'url(#cream)') + path(art.tail.path, color.tail, 'mask="url(#tail-dark)"');
  const arms = (depth) =>
    art.arms
      .filter((arm) => arm.depth === depth)
      .map((arm) => path(arm.path, color[arm.fill]))
      .join('');
  const hugging = group(
    `rotate(${number(pose.hugTilt)} ${pair(art.tail.pivot)})`,
    arms('behind-tail') + tail + arms('in-front-of-tail'),
  );
  const body = path(art.body, color.body) + path(art.belly, 'url(#cream)');
  const feet = art.feet.map((foot) => path(foot, color.paw)).join('');
  const shadow = ellipse(art.shadow.center, art.shadow.radii, color.shadow);
  const clips =
    `<mask id="tail-dark"><path d="M0 0H${art.viewBox[2]}V${art.viewBox[3]}H0Z" fill="white"/>${art.tail.bands.map((band) => path(band, 'black')).join('')}</mask>` +
    `<clipPath id="cry-eye">${path(art.head.eye.iris, color.white)}</clipPath>` +
    `<clipPath id="cry-pupil">${ellipse(art.head.eye.pupil.slice(0, 2), art.head.eye.pupil.slice(2), color.white)}</clipPath>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.size}" height="${art.size}" viewBox="${art.viewBox.join(' ')}"><defs>${lemurGradients(color)}${clips}</defs><path fill="${color.white}" d="M0 0H${art.viewBox[2]}V${art.viewBox[3]}H0Z"/>${group(`translate(${pair(art.offset)})`, shadow + body + hugging + feet + headSvg(pose, time, art, base, motion))}</svg>`;
}
