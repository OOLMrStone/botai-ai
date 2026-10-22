import { blinkAmount, bodyPose, headPose, legPath, tailPoint } from './lemur-continuous-motion.mjs';
import { lemurEyeAperture } from './lemur-svg.mjs';

const number = (value) => Number(value.toFixed(3));
const pair = (point) => point.map(number).join(' ');
const path = (data, fill, attributes = '') => `<path d="${data}" fill="${fill}" ${attributes}/>`;

function ribbonEdges(sample, radius, start, end, count) {
  const left = [];
  const right = [];
  for (let index = 0; index <= count; index++) {
    const position = start + ((end - start) * index) / count;
    const center = sample(position);
    const before = sample(Math.max(0, position - 0.0001));
    const after = sample(Math.min(1, position + 0.0001));
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    const width = radius(position);
    const normal = [(-dy * width) / length, (dx * width) / length];
    left.push([center[0] + normal[0], center[1] + normal[1]]);
    right.push([center[0] - normal[0], center[1] - normal[1]]);
  }
  return { left, right };
}

function tailBandPath(left, right, start, end, sample, radius, config) {
  const boundary = (position) => {
    const center = sample(position);
    const before = sample(Math.max(0, position - 0.0001));
    const after = sample(Math.min(1, position + 0.0001));
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const amount = (radius(position) * config.tail.bandCurve) / Math.hypot(dx, dy);

    return [center[0] + dx * amount, center[1] + dy * amount];
  };

  return `M ${left.map(pair).join(' L ')} Q ${pair(boundary(end))} ${pair(right.at(-1))} L ${right.slice(0, -1).reverse().map(pair).join(' L ')} Q ${pair(boundary(start))} ${pair(left[0])} Z`;
}

function tailSvg(phase, config) {
  const sample = (position) => tailPoint(position, phase, config);
  const radius = (position) =>
    config.tail.radius[0] +
    (config.tail.radius[1] - config.tail.radius[0]) * Math.sin((position * Math.PI) / 2);
  const bands = config.tail.bands.slice(0, -1).map((start, index) => {
    const end = config.tail.bands[index + 1];
    const { left, right } = ribbonEdges(sample, radius, start, end, config.tail.samples);
    const fill = index % 2 ? config.colors.tail : config.colors.cream;
    return path(
      tailBandPath(left, right, start, end, sample, radius, config),
      fill,
      `stroke="${fill}" stroke-width="0.5" stroke-linejoin="round"`,
    );
  });
  const tip = sample(1);
  bands.push(
    `<circle cx="${number(tip[0])}" cy="${number(tip[1])}" r="${number(radius(1))}" fill="${config.colors.tail}"/>`,
  );
  return bands.join('');
}

function legSvg(phase, leg, config) {
  const shape = legPath(phase, leg, config);
  const paw = legPath(phase, leg, config, 'pawPath');
  const fill = leg.far ? config.colors.far : config.colors.body;
  const clip = `${leg.name}-silhouette`;

  return `<g data-layer="${leg.name}"><defs><clipPath id="${clip}">${path(shape, 'white')}</clipPath></defs>${path(shape, fill)}<g clip-path="url(#${clip})">${path(paw, config.colors.paw)}</g></g>`;
}

function mapPath(data, transform) {
  const tokens = data.match(/[MCZ]|-?\d+(?:\.\d+)?/g);
  const result = [];

  for (let index = 0; index < tokens.length; index++) {
    if (/^[MCZ]$/.test(tokens[index])) result.push(tokens[index]);
    else result.push(pair(transform([Number(tokens[index]), Number(tokens[++index])])));
  }

  return result.join(' ');
}

function blendPath(source, target, amount) {
  const targetValues = target.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let index = 0;

  return source.replace(/-?\d+(?:\.\d+)?/g, (value) =>
    number(Number(value) + (targetValues[index++] - Number(value)) * amount),
  );
}

function blendValues(source, target, amount) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      typeof value === 'number' ? value + (target[key] - value) * amount : value,
    ]),
  );
}

function eyeSvg(eye, blink, turn) {
  const { x, y, width, height } = blendValues(eye.bounds, eye.profileBounds, turn);
  const lid = blendValues(eye.blink, eye.profileBlink, turn);
  const aperture = lemurEyeAperture({ x, y, width, height }, lid, blink, 2);
  const shapes = eye.layers
    .map((layer) => path(blendPath(layer.path, layer.profilePath, turn), layer.fill))
    .join('');
  const crease =
    blink > 0.98
      ? `<path d="M ${x + 5} ${lid.closedY} Q ${x + width / 2} ${lid.closedY - lid.curveLift * 2} ${x + width - 5} ${lid.closedY}" fill="none" stroke="${eye.layers[0].fill}" stroke-width="1.5" stroke-linecap="round" opacity="${number((blink - 0.98) / 0.02)}"/>`
      : '';

  const region = blendPath(eye.clipPath, eye.profileClipPath, turn);

  return `<defs><clipPath id="${eye.name}"><path d="${aperture}"/></clipPath><clipPath id="${eye.name}-region">${path(region, 'white')}</clipPath></defs><g clip-path="url(#${eye.name}-region)"><g clip-path="url(#${eye.name})">${shapes}</g>${crease}</g>`;
}

function faceSvg(phase, config, face) {
  const body = bodyPose(phase, config);
  const blink = blinkAmount(phase, config);
  const { turn, smile } = headPose(phase, config);
  const layers = new Map(face.layers.map((layer) => [layer.name, layer]));
  const eyes = new Map(face.eyes.map((eye) => [eye.name, eye]));
  const shaped = (layer) => blendPath(layer.path, layer.profilePath, turn);
  const opening = (data) =>
    mapPath(data, ([x, y]) => [x, config.mouth.pivotY + (y - config.mouth.pivotY) * smile]);
  const faceBoundary = shaped(layers.get('face'));
  const mouthBoundary = opening(shaped(layers.get('mouth')));
  const shapes = face.renderOrder
    .map((entry) => {
      let shape;
      if (entry.kind === 'eye') shape = eyeSvg(eyes.get(entry.name), blink, turn);
      else {
        const layer = layers.get(entry.name);
        const data = shaped(layer);
        shape = path(config.mouth.layers.includes(entry.name) ? opening(data) : data, layer.fill);
        if (entry.name === 'tongue') shape = `<g clip-path="url(#mouth-opening)">${shape}</g>`;
      }

      return face.profileClipNames.includes(entry.name)
        ? `<g clip-path="url(#face-boundary)">${shape}</g>`
        : shape;
    })
    .join('');
  const mouth = config.mouth.closed;
  const closed = `<path d="${blendPath(mouth.path, mouth.profilePath, turn)}" fill="none" stroke="${mouth.stroke}" stroke-width="${mouth.width}" stroke-linecap="round" opacity="${number(1 - smile)}"/>`;

  return `<g transform="translate(${number(body.x)} ${number(body.headY)}) rotate(${number(body.headAngle)} ${pair(face.coordinateSystem.headPivot)})"><defs><clipPath id="face-boundary">${path(faceBoundary, 'white')}</clipPath><clipPath id="mouth-opening">${path(mouthBoundary, 'white')}</clipPath></defs>${shapes}${closed}</g>`;
}

export function lemurFrameSvg(phase, config, face) {
  const body = bodyPose(phase, config);
  const far = config.legs
    .filter((leg) => leg.far)
    .map((leg) => legSvg(phase, leg, config))
    .join('');
  const near = config.legs
    .filter((leg) => !leg.far)
    .map((leg) => legSvg(phase, leg, config))
    .join('');
  const torso = `<g transform="translate(${number(body.x)} ${number(body.y)})"><defs><clipPath id="torso-silhouette">${path(config.torso, 'white')}</clipPath></defs>${path(config.torso, config.colors.body)}<g clip-path="url(#torso-silhouette)">${path(config.belly, config.colors.cream)}</g></g>`;
  const shadow = config.shadow;
  const ground = `<rect x="${shadow.x}" y="${shadow.y}" width="${shadow.width}" height="${shadow.height}" rx="${shadow.radius}" fill="${shadow.fill}" opacity="${shadow.opacity}"/>`;
  const tail = tailSvg(phase, config);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.size}" height="${config.size}" viewBox="${config.viewBox.join(' ')}"><rect x="-100" y="-100" width="800" height="800" fill="white"/>${ground}${far}<g data-layer="tail">${tail}</g>${torso}${near}${faceSvg(phase, config, face)}</svg>`;
}
